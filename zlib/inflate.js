var Inflate;

(function () {
    Inflate = {
        initialize: function () {
            // For zlib frame bytes
            this.zlibBytes = [];
            this.zlibFdict = false;
            // For DEFLATE bytes
            /* Keep track of last 32K bytes for handling back references */
            this.window = new Uint8Array(0x8000);
            this.windowPointer;
            this.blockFinal = null;
            this.blockType = null;
            /* Keep track of any incomplete bits which can't yet be decompressed */
            this.remaining = [];
            return this;
        },
        push: function (input) {
            var i;
            var byte;
            var output = [];
            for (i=0; i<input.length; i++) {
                byte = input[i];
                // zlib section.  Probably should be at the end for
                // perf reasons, but let's not prematurely
                // optimize. :)
                if (this.zlibBytes.length === 0) {
                    // CMF byte
                    console.log(sprintf(
                        'zlib CMF byte: CM: %d, CINFO: %d',
                        byte & 0xf, (byte>>4) & 0xf
                    ));
                    this.zlibBytes.push(byte);
                } else if (this.zlibBytes.length === 1) {
                    // FLG byte
                    console.log(sprintf(
                        'zlib FLG byte: FCHECK: %d, FDICT: %d, FLEVEL: %d',
                        byte & 0x1f, (byte>>5) & 0x1, (byte>>6) & 0x3
                    ));
                    this.zlibFdict = (byte>>5) & 0x1;
                    this.zlibBytes.push(byte);
                } else if (this.zlibFdict && this.zlibBytes.length < 6) {
                    // Read the next 4 bytes as zlib bytes... although
                    // we'll ignore them.
                    if (this.zlibBytes.length == 2) {
                        console.error('Unexpected: zlib fdict flag is true');
                    }
                    this.zlibBytes.push(byte);
                } else {
                    // Now we're into the DEFLATE section.  Let the craziness ensue!
                    // Reason: now we're getting down to bitwise
                    // schtuff...  Likely stuff will be optimizable,
                    // but for now, just doing it will be hard enough.
                    console.log('DEFLATE byte:', byte);
                    if (this.blockType === null) {
                        // Beginning of a new data block.
                        this.blockFinal = byte & 0x1;
                        this.blockType = (byte>1) & 0x3;
                        console.log(sprintf('New data block: type: %d, final: %d', this.blockType, this.blockFinal));
                        // Do nothing else, yet...
                    } else {
                        // Do nothing, yet.
                    }
                }
                // FOR NOW: just push the compressed byte as-is.
                output.push(byte);
            }
            return output;
        },
    };
})();