const { expect } = require('chai');
const {
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
} = require('../lib/mapping');
const ac2221 = require('./fixtures/ac2221.reported.json');
const ac3737 = require('./fixtures/ac3737.reported.json');

// Flatten mapReported's decoded states into a { friendlyName: value } object for concise assertions.
function decoded(reported) {
    const out = {};
    for (const s of mapReported(reported).states) {
        out[s.name] = s.value;
    }
    return out;
}

describe('mapping - mapReported', () => {
    it('decodes attributes, maps options and keeps native types', () => {
        const reported = { pm25: 7, pwr: '1', cl: 0, mode: 'M', om: 'a', name: 'Schlafzimmer' };
        expect(decoded(reported)).to.deep.equal({
            pm25: 7,
            power: true,
            childLock: false,
            mode: 'manual',
            fanSpeed: 'auto',
            name: 'Schlafzimmer',
        });
    });

    it('maps known error codes and keeps unknown ones numeric', () => {
        expect(decoded({ err: 193 }).error).to.equal('pre-filter must be cleaned');
        expect(decoded({ err: 12345 }).error).to.equal(12345);
    });

    it('routes unknown attributes to the unknown list and tolerates a missing object', () => {
        const r = mapReported({ somethingUnknown: 5 });
        expect(r.states).to.deep.equal([]);
        expect(r.unknown).to.deep.equal([{ key: 'somethingUnknown', value: 5 }]);
        expect(() => mapReported(undefined)).to.not.throw();
        expect(mapReported(undefined)).to.deep.equal({ states: [], unknown: [] });
    });

    it('routes each state to the right channel', () => {
        const channels = {};
        for (const s of mapReported({ pwr: '1', pm25: 7, fltsts0: 100, name: 'x' }).states) {
            channels[s.name] = s.channel;
        }
        expect(channels).to.deep.equal({
            power: 'control',
            pm25: 'status',
            preFilterCleanInHours: 'filter',
            name: 'device',
        });
    });

    it('decodes classic and D-code attributes in the same payload (real AC4236 hybrid)', () => {
        const r = mapReported({
            pwr: '1',
            om: '1',
            mode: 'AG',
            pm25: 4,
            D03180: 0,
            D0311F: 1,
            D03R81: '0s123s23t',
            D03182: 1,
        });
        const names = r.states.map(s => s.name);
        // classic attributes are still decoded ...
        expect(names).to.include('power');
        expect(names).to.include('mode');
        // ... and the one mapped D-code is too, even though the device is classic
        expect(names).to.include('autoPlusAi'); // D03180
        // genuinely unmapped D-codes surface as unknown rather than being dropped
        expect(r.unknown.map(u => u.key)).to.have.members(['D0311F', 'D03R81', 'D03182']);
    });
});

describe('mapping - decodeValue', () => {
    it('resolves options, scales numbers and coerces the rest', () => {
        expect(decodeValue(NAME_MAPPING.pwr, '1')).to.equal(true); // option code -> boolean
        expect(decodeValue(DCODE_MAPPING.D03224, 220)).to.equal(22); // tenths -> 22.0 °C
        expect(decodeValue(NAME_MAPPING.pm25, 7)).to.equal(7); // native number kept
        expect(decodeValue(NAME_MAPPING.name, 'Schlafzimmer')).to.equal('Schlafzimmer'); // string kept
        expect(decodeValue(NAME_MAPPING.name, null)).to.equal(''); // nullish coerced to empty string
    });
});

describe('mapping - buildControlPayload', () => {
    it('resolves option values back to their raw device codes', () => {
        expect(buildControlPayload({ power: true })).to.deep.equal({ pwr: '1' });
        expect(buildControlPayload({ fanSpeed: 'auto', mode: 'manual' })).to.deep.equal({ om: 'a', mode: 'M' });
        expect(buildControlPayload({ childLock: false })).to.deep.equal({ cl: '0' });
    });

    it('passes through non-option control values', () => {
        expect(buildControlPayload({ lightBrightness: 50, timerHours: 2 })).to.deep.equal({ aqil: 50, dt: 2 });
    });

    it('only includes control-capable settings', () => {
        // pm25 is read-only (no control flag) and must not end up in the payload
        expect(buildControlPayload({ pm25: 5, power: true })).to.deep.equal({ pwr: '1' });
    });

    it('throws for an invalid option value', () => {
        expect(() => buildControlPayload({ fanSpeed: 'hurricane' })).to.throw(/Invalid option for fanSpeed/);
    });

    it('targets D-codes (as JSON numbers) for new-generation devices', () => {
        // power/childLock/mode resolve to numeric D-code values, not the old string form
        expect(buildControlPayload({ power: true }, true)).to.deep.equal({ D03102: 1 });
        expect(buildControlPayload({ childLock: false }, true)).to.deep.equal({ D03103: 0 });
        expect(buildControlPayload({ mode: 'auto' }, true)).to.deep.equal({ D0310C: 0 });
        // non-option control passes through (target humidity, timer)
        expect(buildControlPayload({ targetHumidity: 50, timerHours: 2 }, true)).to.deep.equal({
            D03128: 50,
            D03110: 2,
        });
    });

    it('does not write the unverified new-gen fan speed / light brightness', () => {
        // these are read-only on new-gen for now, so they must never reach the control payload
        expect(buildControlPayload({ fanSpeed: 3, lightBrightness: 50 }, true)).to.deep.equal({});
    });

    it('keeps the two schemes separate (no old codes leak into new-gen payloads)', () => {
        const payload = buildControlPayload({ power: true }, true);
        expect(payload).to.not.have.property('pwr');
        expect(buildControlPayload({ power: true }, false)).to.deep.equal({ pwr: '1' });
    });
});

describe('mapping - NAME_MAPPING', () => {
    it('is a non-empty shared object used by both protocols', () => {
        expect(NAME_MAPPING).to.be.an('object');
        expect(Object.keys(NAME_MAPPING).length).to.be.greaterThan(30);
        expect(NAME_MAPPING.err.name).to.equal('error');
    });
});

describe('mapping - detectGeneration / isNewGen', () => {
    it('detects the new-generation D-code scheme from real payloads', () => {
        expect(detectGeneration(ac2221)).to.equal('new-gen');
        expect(detectGeneration(ac3737)).to.equal('new-gen');
        expect(isNewGen(ac2221)).to.equal(true);
    });

    it('detects classic devices', () => {
        expect(detectGeneration({ pwr: 1, om: 'a', pm25: 7, DeviceId: 'x' })).to.equal('classic');
        expect(isNewGen({ pwr: 1, om: 'a' })).to.equal(false);
    });

    it('returns null for indeterminate frames so a sparse response cannot flip the scheme', () => {
        // A firmware/filter-style HTTP response carries neither a classic marker nor a D-code.
        expect(detectGeneration({ WifiVersion: 'x', swversion: 'y' })).to.equal(null);
        expect(detectGeneration({})).to.equal(null);
        expect(detectGeneration(undefined)).to.equal(null);
        expect(isNewGen({})).to.equal(false);
        expect(isNewGen(undefined)).to.equal(false);
    });

    it('stays classic when a classic device sprinkles in a few D-codes (real AC4236)', () => {
        // Real AC4236/14 payload: classic scheme plus a handful of extra D-code attributes.
        // Must NOT be misdetected as new-gen, or control would target the wrong (D-code) scheme.
        const ac4236 = {
            type: 'AC4236',
            om: '1',
            pwr: '1',
            mode: 'AG',
            pm25: 4,
            aqit: 4,
            D0311F: 1,
            D03180: 0,
            D03R81: '0s123s23t',
            D03182: 1,
        };
        expect(detectGeneration(ac4236)).to.equal('classic');
        expect(isNewGen(ac4236)).to.equal(false);
    });
});

describe('mapping - mapReported (D-codes)', () => {
    it('decodes the AC2221 (Combo) payload from real logs', () => {
        const r = decoded(ac2221);
        // device info (note: D01S03 = location/room, D01S04 = device name)
        expect(r.name).to.equal('Büro');
        expect(r.roomName).to.equal('Cobra');
        expect(r.modelId).to.equal('AC2221/13');
        expect(r.serial).to.equal('688001004930');
        expect(r.softwareVersion).to.equal('0.2.1');
        // operation + sensors
        expect(r.power).to.equal(true);
        expect(r.childLock).to.equal(false);
        expect(r.mode).to.equal('auto'); // D0310C = 0
        expect(r.fanSpeed).to.equal(1); // D0310D
        expect(r.allergenIndex).to.equal(2);
        expect(r.pm25).to.equal(8);
        expect(r.error).to.equal('none'); // D03240 = 0
        // filters (remaining + total)
        expect(r.preFilterCleanInHours).to.equal(720);
        expect(r.preFilterTotalHours).to.equal(720);
        expect(r.hepaFilterReplaceInHours).to.equal(19200);
        expect(r.hepaFilterTotalHours).to.equal(19200);
        // unmapped codes surface under unknownStates instead of being dropped
        const unknown = Object.fromEntries(mapReported(ac2221).unknown.map(u => [u.key, u.value]));
        expect(unknown.D0313B).to.equal(20);
    });

    it('decodes the AC3737 payload incl. scaled temperature and 2nd filter', () => {
        const r = decoded(ac3737);
        expect(r.modelId).to.equal('AC3737/10');
        expect(r.power).to.equal(true);
        expect(r.fanSpeed).to.equal(5); // D0310D
        expect(r.temperature).to.equal(22); // D03224 = 220 -> 22.0 °C
        expect(r.humidity).to.equal(53);
        expect(r.targetHumidity).to.equal(60);
        expect(r.humidifying).to.equal(true); // D0312B = 1
        expect(r.error).to.equal('none');
        // active carbon / wick filter (AC3737 second filter)
        expect(r.activeCarbonFilterReplaceInHours).to.equal(2398);
        expect(r.activeCarbonFilterTotalHours).to.equal(2400);
    });
});

describe('mapping - channelOf & stateCommon', () => {
    it('routes each entry to the right object-tree channel', () => {
        expect(channelOf(NAME_MAPPING.pwr)).to.equal('control');
        expect(channelOf(NAME_MAPPING.fltsts0)).to.equal('filter');
        expect(channelOf(NAME_MAPPING.name)).to.equal('device');
        expect(channelOf(NAME_MAPPING.pm25)).to.equal('status');
    });

    it('builds an ioBroker common block (single source of truth for device states)', () => {
        // boolean control -> writable switch
        expect(stateCommon(NAME_MAPPING.pwr)).to.deep.equal({
            name: 'power',
            type: 'boolean',
            role: 'switch',
            read: true,
            write: true,
        });
        // sensor with explicit role/unit, read-only
        expect(stateCommon(DCODE_MAPPING.D03224)).to.deep.equal({
            name: 'temperature',
            type: 'number',
            role: 'value.temperature',
            read: true,
            write: false,
            unit: '°C',
        });
        // device info defaults to a read-only string
        expect(stateCommon(NAME_MAPPING.name)).to.deep.equal({
            name: 'name',
            type: 'string',
            role: 'text',
            read: true,
            write: false,
        });
        // uptime overrides the inferred type and stays numeric
        expect(stateCommon(NAME_MAPPING.Runtime).type).to.equal('number');
    });

    it('exposes option controls as a dropdown but keeps booleans plain', () => {
        expect(stateCommon(DCODE_MAPPING.D0310C).states).to.deep.equal({
            off: 'off',
            auto: 'auto',
            sleep: 'sleep',
            turbo: 'turbo',
            gentle: 'gentle',
        });
        expect(stateCommon(NAME_MAPPING.cl)).to.not.have.property('states');
    });
});

describe('mapping - STATE_MAPPING & DCODE_MAPPING', () => {
    it('merges both schemes without raw-key collisions', () => {
        const keys = new Set(Object.keys(STATE_MAPPING));
        expect(keys.size).to.equal(Object.keys(NAME_MAPPING).length + Object.keys(DCODE_MAPPING).length);
        expect(STATE_MAPPING.pwr.name).to.equal('power'); // old scheme still present
        expect(STATE_MAPPING.D03102.name).to.equal('power'); // new scheme added
    });
});
