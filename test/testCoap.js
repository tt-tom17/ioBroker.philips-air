const { expect } = require('chai');
const AirPurifier = require('../lib/coap');

// Build an instance without running the constructor (which would start networking).
function makeInstance(clientKey = 'AABBCCDD') {
    const inst = Object.create(AirPurifier.prototype);
    inst.clientKey = clientKey;
    inst.deviceIp = '127.0.0.1';
    inst.emit = () => {};
    return inst;
}

describe('coap - encryption', () => {
    it('encryptPayload output can be decrypted back to the original payload', async () => {
        const inst = makeInstance();
        const payload = { state: { desired: { om: '1', pwr: '1', CommandType: 'app' } } };

        const encrypted = await inst.encryptPayload(payload);
        expect(encrypted).to.be.a('string');

        const decrypted = await inst.decryptPayload(Buffer.from(encrypted));
        expect(JSON.parse(decrypted)).to.deep.equal(payload);
    });

    it('decryptPayload rejects a tampered (corrupted) message', async () => {
        const inst = makeInstance();
        const encrypted = await inst.encryptPayload({ a: 1 });
        // flip a character in the encrypted body to break the digest
        const tampered = `${encrypted.slice(0, 12)}${encrypted[12] === '0' ? '1' : '0'}${encrypted.slice(13)}`;
        expect(() => inst.decryptPayload(Buffer.from(tampered))).to.throw(/corrupted/i);
    });

    it('updateClientKey increments the key as an 8-char uppercase hex counter', () => {
        const inst = makeInstance('0000000F');
        inst.updateClientKey();
        expect(inst.clientKey).to.equal('00000010');
    });

    it('updateClientKey handles keys with the high bit set (unsigned 32-bit)', () => {
        const inst = makeInstance('AABBCCDD');
        inst.updateClientKey();
        expect(inst.clientKey).to.equal('AABBCCDE');
    });

    it('updateClientKey wraps around at 0xFFFFFFFF', () => {
        const inst = makeInstance('FFFFFFFF');
        inst.updateClientKey();
        expect(inst.clientKey).to.equal('00000000');
    });
});

describe('coap - detectScheme', () => {
    it('records the detected generation and leaves the raw status untouched', () => {
        const inst = makeInstance();
        const reported = { pwr: '1', om: 'a', pm25: 7 };
        inst.detectScheme({ state: { reported } });
        expect(inst.generation).to.equal('classic');
        // decoding now happens generation-agnostically in main.js, so the raw keys stay as-is
        expect(reported).to.deep.equal({ pwr: '1', om: 'a', pm25: 7 });
    });

    it('is sticky: an indeterminate frame does not clear a known generation', () => {
        const inst = makeInstance();
        inst.detectScheme({ state: { reported: { D03102: 1, D0310D: 2 } } });
        expect(inst.generation).to.equal('new-gen');
        // a sparse follow-up frame (no marker, no D-code) must not flip the scheme
        inst.detectScheme({ state: { reported: { WifiVersion: 'x' } } });
        expect(inst.generation).to.equal('new-gen');
    });

    it('tolerates a malformed status object', () => {
        const inst = makeInstance();
        expect(() => inst.detectScheme({})).to.not.throw();
        expect(inst.generation).to.equal(undefined);
    });
});
