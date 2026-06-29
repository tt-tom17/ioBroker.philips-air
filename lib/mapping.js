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
// const.py (NEW2_* constants), the authoritative reference for the D-code scheme:
//   https://github.com/kongo09/philips-airpurifier-coap
//   https://github.com/kongo09/philips-airpurifier-coap/blob/master/custom_components/philips_airpurifier_coap/const.py
// Codes that even kongo09 does not map are intentionally omitted so they surface in the
// "unmapped attributes" info log instead of being guessed.
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
    // -16 is the idle sentinel a powered-off device reports for the mode field (confirmed on a real
    // AC3221); map it to 'off' so the state never surfaces the raw value.
    D0310C: {
        name: 'mode',
        options: { '-16': 'off', 0: 'auto', 17: 'sleep', 18: 'turbo', 19: 'gentle' },
        control: true,
    },
    D03128: { name: 'targetHumidity', control: true, role: 'level.humidity', unit: '%' }, // 40-70 %
    D03110: { name: 'timerHours', control: true, role: 'level.timer', unit: 'hours' },

    // Read-only for now: fan-speed (kongo NEW2_FAN_SPEED) uses a numeric, model-specific encoding
    // that differs from the old string/percent scheme and is not yet verified on a live device.
    // Exposed as a sensor so the value is visible; writing is deferred to avoid an untested command.
    // See PHASE-5 plan.
    D0310D: { name: 'fanSpeed', role: 'value' },
    // Display backlight: discrete steps + auto (kongo NEW2_DISPLAY_BACKLIGHT, "3 steps with auto").
    // Decode the model-specific codes to friendly labels, but keep read-only - writing these untested
    // encodings is deferred like fan-speed above.
    D03105: { name: 'lightBrightness', options: { 0: 'off', 101: 'auto', 115: 'low', 123: 'bright' } },

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

// Classic operational markers. A genuine new-generation device expresses these as D-codes
// (e.g. power = D03102, fan = D0310D) and never sends the short classic keys. Some classic
// devices, however, sprinkle a few D-code attributes into an otherwise classic payload (real
// example: AC4236 emits D0311F/D03180/D03R81/D03182 alongside pwr/om/mode/...). Their presence
// alone must therefore not flip generation detection.
const CLASSIC_MARKERS = ['pwr', 'om', 'mode', 'pm25', 'aqit'];

/**
 * Classify the protocol generation of a reported status.
 *
 * Returns 'classic' as soon as a classic operational marker is present (a classic device may
 * additionally sprinkle in a few D-code attributes), 'new-gen' only when D-codes are present and
 * no classic marker is, and null when the frame is indeterminate (e.g. a sparse HTTP
 * firmware/filter response that carries neither). Callers should treat null as "keep the previous
 * decision" so a single ambiguous frame can never flip the device's scheme.
 *
 * @param reported a flat object of raw device attributes (the "reported" status)
 * @returns 'classic' | 'new-gen' | null
 */
function detectGeneration(reported) {
    if (!reported) {
        return null;
    }
    if (CLASSIC_MARKERS.some(m => Object.prototype.hasOwnProperty.call(reported, m))) {
        return 'classic';
    }
    if (Object.keys(reported).some(k => /^D0\d/.test(k))) {
        return 'new-gen';
    }
    return null;
}

/**
 * Convenience boolean for the control direction: true only for a confidently new-generation frame.
 *
 * @param reported a flat object of raw device attributes (the "reported" status)
 * @returns true if the device uses the new-generation D-code scheme
 */
function isNewGen(reported) {
    return detectGeneration(reported) === 'new-gen';
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
 * Decode a single raw device value into its friendly representation: resolve option codes to their
 * text/boolean, scale numeric readings, and keep native numbers/booleans (coercing only the rest so
 * typed states are not rejected).
 *
 * @param item the mapping entry for the attribute
 * @param val the raw reported value
 * @returns the decoded value
 */
function decodeValue(item, val) {
    if (item.options && Object.prototype.hasOwnProperty.call(item.options, val)) {
        return item.options[val];
    }
    if (item.scale !== undefined) {
        // Scaled numeric reading (e.g. temperature reported as tenths of a degree).
        const num = typeof val === 'number' ? val : parseFloat(val);
        return Number.isNaN(num) ? val : Math.round(num * item.scale * 10) / 10;
    }
    return typeof val === 'number' || typeof val === 'boolean' ? val : (val ?? '').toString();
}

/**
 * Map a raw reported status to decoded, routed device states - independent of protocol generation.
 *
 * Each raw attribute is looked up in the merged STATE_MAPPING (raw keys never collide between the
 * classic and D-code schemes), so a device that mixes both - e.g. a classic AC4236 that also emits
 * a few D-codes - is decoded correctly without picking a single scheme up front. Attributes no
 * scheme maps are returned separately so the caller can surface them under `unknownStates`.
 *
 * @param reported a flat object of raw device attributes (the "reported" status)
 * @returns an object with `states` (decoded, routed entries: key, name, item, channel, value) and
 *   `unknown` (entries no scheme maps: key, value)
 */
function mapReported(reported) {
    const states = [];
    const unknown = [];
    if (!reported) {
        return { states, unknown };
    }
    for (const key of Object.keys(reported)) {
        const item = STATE_MAPPING[key];
        const val = reported[key];
        if (!item) {
            unknown.push({ key, value: val });
            continue;
        }
        states.push({ key, name: item.name, item, channel: channelOf(item), value: decodeValue(item, val) });
    }
    return { states, unknown };
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
    detectGeneration,
    channelOf,
    stateCommon,
    decodeValue,
    mapReported,
    buildControlPayload,
};
