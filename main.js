'use strict';

// The adapter-core module gives you access to the core ioBroker functions
// you need to create an adapter
const utils = require('@iobroker/adapter-core');
const { mapReported, stateCommon } = require('./lib/mapping');
const adapterName = require('./package.json').name.split('.').pop();

/**
 * The adapter instance
 *
 */
let adapter;
let airPurifier;
// The selected purifier class (CoAP or HTTP) is loaded lazily in main() depending on the
// configured protocol, so a missing optional `philips-air` dependency cannot crash CoAP users.
let PurifierClass;

/**
 * Starts the adapter instance
 *
 * @param [options] adapter options passed through to the ioBroker adapter
 */
function startAdapter(options) {
    // Create the adapter and define its methods
    return (adapter = utils.Adapter(
        Object.assign({}, options, {
            name: adapterName,

            // The ready callback is called when databases are connected and adapter received configuration.
            // start here!
            ready: main, // Main method defined below for readability

            // is called when adapter shuts down - callback has to be called under any circumstances!
            unload: callback => {
                try {
                    adapter.setState('info.connection', false, true);
                    airPurifier && airPurifier.destroy();
                    airPurifier = null;
                    callback();
                } catch {
                    callback();
                }
            },

            // If you need to react to object changes, uncomment the following method.
            // You also need to subscribe to the objects with `adapter.subscribeObjects`, similar to `adapter.subscribeStates`.
            // objectChange: (id, obj) => {
            //     if (obj) {
            //         // The object was changed
            //         adapter.log.info(`object ${id} changed: ${JSON.stringify(obj)}`);
            //     } else {
            //         // The object was deleted
            //         adapter.log.info(`object ${id} deleted`);
            //     }
            // },

            // is called if a subscribed state changes
            stateChange: (id, state) => {
                adapter.log.debug(`State change: ${JSON.stringify(state)}`);
                if (state && !state.ack && id.startsWith(`${adapter.namespace}.control.`)) {
                    const name = id.substring(`${adapter.namespace}.control.`.length);
                    const settings =
                        name === 'function'
                            ? { function: state.val ? 'humidification' : 'purification' }
                            : { [name]: state.val };
                    try {
                        const result = airPurifier && airPurifier.control(settings);
                        // control() returns a promise - catch async failures too, otherwise a failed
                        // command produces an unhandled rejection that crashes the adapter.
                        if (result && typeof result.catch === 'function') {
                            result.catch(err =>
                                adapter.log.warn(
                                    `Could not control ${name}: ${err && err.message ? err.message : err}`,
                                ),
                            );
                        }
                    } catch (err) {
                        adapter.log.warn(`Could not control ${name}: ${err.message}`);
                    }
                }
            },
        }),
    ));
}

// Device states are created on demand from the mapping (io-package.json only defines the adapter's
// own infrastructure). Ids already ensured this run are cached so we touch the object DB only once.
const ensuredObjects = new Set();

/**
 * Create the state object once (from a mapping-derived common block) if it does not exist yet, then
 * write the value.
 *
 * @param id the state id (e.g. "status.pm25")
 * @param common the ioBroker object `common` block
 * @param value the value to write (always acknowledged)
 */
async function setDeviceState(id, common, value) {
    if (!ensuredObjects.has(id)) {
        await adapter.setObjectNotExistsAsync(id, { type: 'state', common, native: {} });
        ensuredObjects.add(id);
    }
    await adapter.setStateAsync(id, value, true);
}

/**
 * Create a channel object once (cached) so dynamically discovered states have a tidy parent.
 *
 * @param id the channel id (e.g. "unknownStates")
 * @param name the human-readable channel name
 */
async function ensureChannel(id, name) {
    if (!ensuredObjects.has(id)) {
        await adapter.setObjectNotExistsAsync(id, { type: 'channel', common: { name }, native: {} });
        ensuredObjects.add(id);
    }
}

async function updateStatus(reported) {
    // Decode and route every raw attribute generation-agnostically: mapReported keys off the raw
    // device code (which never collides between the classic and D-code schemes), so a device that
    // mixes both is handled correctly without choosing a single table up front.
    const { states, unknown } = mapReported(reported);

    for (const { name, item, channel, value } of states) {
        // The 'function' state is presented as a humidification on/off switch, not the raw text.
        if (name === 'function') {
            await setDeviceState(
                'control.function',
                { name: 'function', type: 'boolean', role: 'switch', read: true, write: true },
                value === 'humidification',
            );
            continue;
        }

        // Uptime additionally drives a derived "started" timestamp.
        if (name === 'uptime') {
            await setDeviceState('device.uptime', stateCommon(item), value);
            const date = new Date();
            date.setMilliseconds(date.getMilliseconds() - value);
            await setDeviceState(
                'device.started',
                { name: 'started', type: 'string', role: 'value.time', read: true, write: false },
                date.toISOString(),
            );
            continue;
        }

        // The error code drives a derived maintenance indicator. Known codes are decoded to a text;
        // unknown codes stay numeric. Only a known, non-'none' error means real maintenance is
        // required - some models (e.g. AC2889) constantly report an undocumented code (193) while
        // perfectly healthy, which must not raise a false maintenance flag.
        if (name === 'error') {
            const isKnownError = typeof value === 'string';
            await setDeviceState('device.error', stateCommon(item), isKnownError ? value : `unknown (${value})`);
            await setDeviceState(
                'device.maintenance',
                { name: 'maintenance', type: 'boolean', role: 'indicator.maintenance', read: true, write: false },
                isKnownError && value !== 'none',
            );
            continue;
        }

        await setDeviceState(`${channel}.${name}`, stateCommon(item), value);
    }

    // Surface any reported attribute that no scheme maps yet under a dedicated `unknownStates`
    // channel, so the user can observe and evaluate raw values (e.g. new-generation D-codes that
    // kongo09 does not document). Created on demand only, read-only - never written back, so an
    // unverified code can never be sent to the device.
    if (unknown.length) {
        await ensureChannel('unknownStates', 'Unmapped device attributes');
        for (const { key, value } of unknown) {
            const type = typeof value === 'number' ? 'number' : typeof value === 'boolean' ? 'boolean' : 'string';
            await setDeviceState(
                `unknownStates.${key}`,
                {
                    name: key,
                    type,
                    role: type === 'number' ? 'value' : type === 'boolean' ? 'indicator' : 'text',
                    read: true,
                    write: false,
                },
                type === 'string' && typeof value !== 'string' ? JSON.stringify(value) : value,
            );
        }
    }
}

async function main() {
    // Reset the connection indicator during startup
    await adapter.setStateAsync('info.connection', false, true);

    if (!adapter.config.host) {
        return adapter.log.warn('No IP defined');
    }

    // In order to get state updates, you need to subscribe to them. The following line adds a subscription for our variable we have created above.
    adapter.subscribeStates('control.*');
    adapter.log.debug(`start with ${adapter.config.host} ${JSON.stringify(adapter.config)}`);

    // Load only the protocol implementation that is actually used.
    try {
        PurifierClass = adapter.config.protocol === 'http' ? require('./lib/http') : require('./lib/coap');
    } catch (err) {
        return adapter.log.error(`Cannot load protocol "${adapter.config.protocol}": ${err.message}`);
    }

    adapter.log.info(
        `Connecting to ${adapter.config.host} using ${adapter.config.protocol === 'http' ? 'HTTP' : 'CoAP'} protocol`,
    );
    airPurifier = new PurifierClass(adapter.config.host, adapter.config, adapter);
    adapter.log.debug('started');

    airPurifier.on('connected', connected => {
        adapter.log.debug(connected ? 'connected' : 'disconnected');
        adapter.setState('info.connection', connected, true);
    });

    airPurifier.on('status', async status => {
        // Surface the raw device status at info level when the user enabled the "Show device status"
        // option, so it is visible without switching the whole adapter to debug logging.
        const statusMsg = `STATUS: ${JSON.stringify(status)}`;
        if (adapter.config.showStatus) {
            adapter.log.info(statusMsg);
        } else {
            adapter.log.debug(statusMsg);
        }
        // Expose the detected protocol generation (classic vs new-gen D-code) for transparency. The
        // client keeps this sticky, so an ambiguous frame never clears it.
        if (airPurifier.generation) {
            await setDeviceState(
                'device.protocolGeneration',
                { name: 'protocolGeneration', type: 'string', role: 'text', read: true, write: false },
                airPurifier.generation,
            );
        }
        await updateStatus(status);
    });

    airPurifier.on('info', async status => {
        adapter.log.info(status);
    });

    airPurifier.on('debug', async status => {
        adapter.log.debug(status);
    });

    airPurifier.on('warn', async status => {
        adapter.log.warn(status);
    });

    airPurifier.on('error', async status => {
        adapter.log.error(status);
    });
}

if (module.parent) {
    // Export startAdapter in compact mode
    module.exports = startAdapter;
} else {
    // otherwise start the instance directly
    startAdapter();
}
