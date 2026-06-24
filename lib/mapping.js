// Shared attribute mapping and helpers used by both the CoAP and HTTP protocol implementations.
// Keeping this in one place avoids the two protocol files drifting apart.

const NAME_MAPPING = {
    rhset: { name: 'targetHumidity', control: true, role: 'level.humidity', unit: '%' },
    func: { name: 'function', options: { P: 'purification', PH: 'humidification' }, control: true },
    pwr: { name: 'power', options: { 1: true, 0: false }, control: true },
    om: {
        name: 'fanSpeed',
        options: { s: 'silent', t: 'turbo', a: 'auto', 1: '1', 2: '2', 3: '3' },
        control: true,
        role: 'level.speed',
    },
    aqil: { name: 'lightBrightness', control: true, role: 'level.brightness', unit: '%' },
    aqit: { name: 'airQualityNotificationThreshold', control: true },
    uil: { name: 'buttonLight', options: { 1: true, 0: false }, control: true },
    rh: { name: 'humidity', role: 'value.humidity', unit: '%' },
    iaql: { name: 'allergenIndex', role: 'value' },
    temp: { name: 'temperature', role: 'value.temperature', unit: '°C' },
    wl: { name: 'waterLevel', role: 'value.fill', unit: '%' },
    cl: { name: 'childLock', options: { 1: true, 0: false }, control: true },
    swversion: { name: 'softwareVersion', device: true },
    name: { name: 'name', device: true },
    type: { name: 'type', device: true },
    modelid: { name: 'modelId', device: true },
    WifiVersion: { name: 'wifiVersion', device: true },
    ProductId: { name: 'productId', device: true },
    DeviceId: { name: 'deviceId', device: true },
    StatusType: { name: 'statusType', device: true },
    ConnectType: { name: 'connectType', device: true },
    ota: { name: 'overTheAirUpdates', device: true },
    Runtime: { name: 'uptime', device: true, type: 'number', role: 'value.interval', unit: 'ms' },
    pm25: { name: 'pm25', role: 'value' },
    tvoc: { name: 'totalVolatileOrganicCompounds', role: 'value' },
    mode: {
        name: 'mode',
        options: {
            P: 'auto',
            A: 'allergen',
            S: 'sleep',
            M: 'manual',
            B: 'bacteria',
            N: 'night',
            T: 'turbo',
            AG: 'automode',
            GT: 'gentle',
        },
        control: true,
    },
    ddp: { name: 'usedIndex', options: { 3: 'humidity', 1: 'pm2.5', 0: 'iai' }, control: true },
    rddp: { name: 'rddp' },
    dt: { name: 'timerHours', control: true, role: 'level.timer', unit: 'hours' },
    dtrs: { name: 'timerMinutes', unit: 'min' },
    fltt1: { name: 'hepaFilterType', options: { A3: 'NanoProtect Filter Series 3 (FY2422)' }, filter: true },
    fltt2: { name: 'activeCarbonFilterType', options: { C7: 'NanoProtect Filter AC (FY2420)' }, filter: true },
    fltsts0: { name: 'preFilterCleanInHours', filter: true, unit: 'hours' },
    fltsts1: { name: 'hepaFilterReplaceInHours', filter: true, unit: 'hours' },
    fltsts2: { name: 'activeCarbonFilterReplaceInHours', filter: true, unit: 'hours' },
    wicksts: { name: 'wickFilterReplaceInHours', filter: true, unit: 'hours' },
    err: {
        name: 'error',
        options: {
            0: 'none',
            // 193 (0xC1) is reported by the AC2889 for this condition. Confirmed live: on a pre-filter
            // reset err goes 193 -> 0, so the error code (not the filter hours) drives this message.
            193: 'pre-filter must be cleaned',
            0x8000: 'water tank open',
            0xc003: 'pre-filter must be cleaned',
            0xc100: 'no water',
        },
        device: true,
    },
};

// Mapping for the new-generation "D-code" devices (V3 protocol, e.g. AC2221, AC3737, AC3221).
// These speak the same encrypted CoAP transport as the AC2889 but report a completely different,
// hierarchical data model (D01xx = device info, D03xx = operation/sensors, D05xx = filters).
// Meanings verified against real device log payloads and the kongo09/philips-airpurifier-coap
// const.py (NEW2_* constants). Codes that even kongo09 does not map are intentionally omitted so
// they surface in the "unmapped attributes" info log instead of being guessed.
const DCODE_MAPPING = {
    // Device / product info (D01)
    D01S03: { name: 'name', device: true },
    D01S04: { name: 'roomName', device: true },
    D01S05: { name: 'modelId', device: true },
    D01S0D: { name: 'serial', device: true, role: 'info.serial' },
    D01S12: { name: 'softwareVersion', device: true },

    // Control (confident codes only - see PHASE-5 plan)
    D03102: { name: 'power', options: { 1: true, 0: false }, control: true },
    D03103: { name: 'childLock', options: { 1: true, 0: false }, control: true },
    D0310C: { name: 'mode', options: { 0: 'auto', 17: 'sleep', 18: 'turbo', 19: 'gentle' }, control: true },
    D03128: { name: 'targetHumidity', control: true, role: 'level.humidity', unit: '%' }, // 40-70 %
    D03110: { name: 'timerHours', control: true, role: 'level.timer', unit: 'hours' },

    // Read-only for now: fan-speed (kongo NEW2_FAN_SPEED) and light brightness use numeric, model-
    // specific encodings that differ from the old string/percent scheme and are not yet verified on a
    // live device. Exposed as sensors so values are visible; writing is deferred to avoid sending an
    // untested command. See PHASE-5 plan.
    D0310D: { name: 'fanSpeed', role: 'value' },
    D03105: { name: 'lightBrightness', role: 'value.brightness' },

    // Sensors / status (D03)
    D03120: { name: 'allergenIndex', role: 'value' }, // air quality index 0-12
    D03221: { name: 'pm25', role: 'value' }, // PM2.5 µg/m³
    D03224: { name: 'temperature', scale: 0.1, role: 'value.temperature', unit: '°C' }, // raw / 10 -> °C
    D03125: { name: 'humidity', role: 'value.humidity', unit: '%' }, // %
    D03211: { name: 'timerMinutes', unit: 'min' }, // remaining timer minutes
    D0312B: { name: 'humidifying', options: { 1: true, 0: false } }, // humidification active
    D03130: { name: 'beep' },
    D03135: { name: 'lampMode' },
    D03137: { name: 'ambientLightMode' },
    D03134: { name: 'standbySensors' },
    D03180: { name: 'autoPlusAi' },
    D0312A: { name: 'preferredIndex' },
    D03240: {
        name: 'error',
        // bitfield (kongo: bit 8 = water tank empty); 0 = healthy. Unknown non-zero codes stay
        // numeric and main.js then flags maintenance, matching the AC2889 error handling.
        options: { 0: 'none' },
        device: true,
    },

    // Filters / maintenance (D05). Even codes count down (hours remaining), the paired *_TOTAL
    // codes are the rated lifetime - confirmed by AC3737 (D0520D=714 vs D05207=720).
    D0520D: { name: 'preFilterCleanInHours', filter: true, unit: 'hours' },
    D05207: { name: 'preFilterTotalHours', filter: true, unit: 'hours' },
    D0540E: { name: 'hepaFilterReplaceInHours', filter: true, unit: 'hours' },
    D05408: { name: 'hepaFilterTotalHours', filter: true, unit: 'hours' },
    D05213: { name: 'activeCarbonFilterReplaceInHours', filter: true, unit: 'hours' }, // AC3737 2nd filter
    D05212: { name: 'activeCarbonFilterTotalHours', filter: true, unit: 'hours' },
};

// Combined lookup used for decoding reported status. Raw keys never collide (old codes are
// lower-case/short, D-codes start with "D0" + digit), so a plain merge is safe. A device only ever
// sends one scheme, so only matching keys are touched at runtime.
const STATE_MAPPING = { ...NAME_MAPPING, ...DCODE_MAPPING };

/**
 * Detect whether a reported status uses the new-generation D-code scheme.
 *
 * @param reported a flat object of raw device attributes (the "reported" status)
 * @returns true if any key is a D-code (D0 followed by a digit), e.g. D03102
 */
function isNewGen(reported) {
    return !!reported && Object.keys(reported).some(k => /^D0\d/.test(k));
}

/**
 * The object-tree channel a mapped state belongs to.
 *
 * @param item a mapping entry
 * @returns one of 'control' | 'filter' | 'device' | 'status'
 */
function channelOf(item) {
    if (item.control) {
        return 'control';
    }
    if (item.filter) {
        return 'filter';
    }
    if (item.device) {
        return 'device';
    }
    return 'status';
}

/**
 * Infer the ioBroker state type for a mapping entry when it is not given explicitly.
 *
 * @param item a mapping entry
 * @returns 'boolean' | 'string' | 'number'
 */
function inferType(item) {
    if (item.type) {
        return item.type;
    }
    if (item.options) {
        return Object.values(item.options).every(v => typeof v === 'boolean') ? 'boolean' : 'string';
    }
    // device info is textual (ids, names, versions); everything else (sensors, filters, numeric
    // controls, scaled readings) is numeric. Numeric exceptions like uptime carry an explicit type.
    return item.device ? 'string' : 'number';
}

/**
 * Build the ioBroker object `common` block for a mapped device state. This makes the mapping the
 * single source of truth, so device states can be created dynamically instead of being duplicated in
 * io-package.json (which only holds the adapter's own infrastructure states).
 *
 * @param item a mapping entry
 * @returns an ioBroker state `common` object
 */
function stateCommon(item) {
    const type = inferType(item);
    const common = {
        name: item.name,
        type,
        role:
            item.role ||
            (type === 'boolean' ? (item.control ? 'switch' : 'indicator') : type === 'string' ? 'text' : 'value'),
        read: true,
        write: !!item.control,
    };
    if (item.unit) {
        common.unit = item.unit;
    }
    // Offer a dropdown for option-based controls (the renamed friendly value is both key and label).
    if (item.options) {
        const values = Object.values(item.options);
        if (!values.every(v => typeof v === 'boolean')) {
            common.states = {};
            values.forEach(v => (common.states[v] = String(v)));
        }
    }
    return common;
}

/**
 * Rename the raw device attributes of a flat reported object to the friendly state names, mapping
 * option values and keeping native numbers/booleans. Operates in place.
 *
 * @param reported a flat object of raw device attributes (the "reported" status)
 */
function renameReported(reported) {
    if (!reported) {
        return;
    }
    Object.keys(reported).forEach(attr => {
        const map = STATE_MAPPING[attr];
        if (!map) {
            return;
        }
        const val = reported[attr];
        delete reported[attr];
        if (map.options && Object.prototype.hasOwnProperty.call(map.options, val)) {
            reported[map.name] = map.options[val];
        } else if (map.scale !== undefined) {
            // Scaled numeric reading (e.g. temperature reported as tenths of a degree).
            const num = typeof val === 'number' ? val : parseFloat(val);
            reported[map.name] = Number.isNaN(num) ? val : Math.round(num * map.scale * 10) / 10;
        } else {
            // Keep native numbers/booleans so typed states are not rejected; coerce only the rest.
            reported[map.name] = typeof val === 'number' || typeof val === 'boolean' ? val : (val ?? '').toString();
        }
    });
}

/**
 * Build the raw control payload (device attribute -> raw value) from friendly state settings.
 *
 * Picks the matching scheme: the old AC2889-style codes by default, or the new-generation D-codes
 * when newGen is true. The two must never be mixed - a new device rejects (or ignores) the old keys
 * and vice versa.
 *
 * @param settings mapping of friendly state names to desired values
 * @param [newGen] whether the target device uses the new-generation D-code scheme
 * @returns the raw payload keyed by device attribute
 */
function buildControlPayload(settings, newGen) {
    const mapping = newGen ? DCODE_MAPPING : NAME_MAPPING;
    const payload = {};
    Object.keys(mapping)
        .filter(attr => mapping[attr].control)
        .forEach(attr => {
            const map = mapping[attr];
            if (!Object.prototype.hasOwnProperty.call(settings, map.name)) {
                return;
            }
            if (map.options) {
                const key = Object.keys(map.options).find(k => map.options[k] == settings[map.name]);
                if (key === undefined) {
                    throw new Error(
                        `Invalid option for ${map.name}: ${settings[map.name]}. Supported only: ${JSON.stringify(map.options)}`,
                    );
                }
                // D-code devices expect JSON numbers; the old scheme keeps the historical string form.
                payload[attr] = newGen && /^[0-9]+$/.test(key) ? parseInt(key, 10) : key;
            } else {
                payload[attr] = settings[map.name];
            }
        });
    return payload;
}

module.exports = {
    NAME_MAPPING,
    DCODE_MAPPING,
    STATE_MAPPING,
    isNewGen,
    channelOf,
    stateCommon,
    renameReported,
    buildControlPayload,
};
