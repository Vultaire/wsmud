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
            this.handleDataBlockEnd();
            return this;
        },
        handleDataBlockEnd: function () {
            this.blockFinal = null;
            this.blockType = null;
            this.len = null;
            this.nlen = null;
            /* Keep track of any incomplete bits which can't yet be decompressed */
            if (this.remaining && this.remaining.length > 0) {
                console.error('Throwing away remaining bytes:', this.remaining);
            }
            this.remaining = [];
            this.currentBit = 0;
            // Common stuff for all huffman code handling
            this.literalLengthMap = null;
            this.distanceMap = null;
            // Store current huffman code; do << 1 + bit for each new bit.
            this.currentHuffman = null;

            // For handling dynamic huffman codes
            this.hlit = null;
            this.hdist = null;
            this.hclen = null;
            this.codeLengthCodeLengths = [];
            this.codeLengthMap = null;
            this.literalLengthCodeLengths = [];
            this.distanceCodeLengths = [];
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
                    this.remaining.push(byte);
                    if (this.blockType === null) {
                        // Beginning of a new data block.
                        this.blockFinal = byte & 0x1;
                        this.blockType = (byte>1) & 0x3;
                        console.log(sprintf('New data block: type: %d, final: %d', this.blockType, this.blockFinal));
                        if (this.blockType === 0) {
                            // Skip remaining bits
                            continue;
                        } else {
                            this.currentBit = 3;
                            output = output.concat(this.handleCompressedBits());
                        }
                    } else if (this.blockType === 0) {
                        if (this.len === null) {
                            if (this.remaining.length === 4) {
                                this.len = this.remaining[0] + (this.remaining[1] << 8);
                                this.nlen = this.remaining[2] + (this.remaining[3] << 8);
                                // TO DO: len/nlen one's complement check.
                                // (Not strictly needed for our purposes I
                                // think.)
                                this.remaining = [];
                            }
                        } else {
                            // Literal data: push to output
                            output.push(byte);
                            if (this.remaining.length === this.len) {
                                this.handleDataBlockEnd();
                            }
                        }
                    } else {
                        output = output.concat(this.handleCompressedBits());
                    }
                }
                // FOR NOW: just push the compressed byte as-is.
                // (This is debug code; I don't mind if we dupe stuff.
                // It'll eventually be removed.)
                output.push(byte);
            }
            return output;
        },
        handleCompressedBits: function () {
            var output = [];

            if (this.literalLengthMap === null) {
                if (this.blockType === 1) {
                    this.createFixedHuffmanMaps();
                } else {
                    console.error('NOT IMPLEMENTED');
                }
                if (this.literalLengthMap === null) {
                    // Could not yet create the map based upon the
                    // current bits available
                    return output;
                }
                console.log('literal/length map', this.literalLengthMap);
            }
            if (this.distanceMap === null && this.blockType === 2) {
                console.error('NOT IMPLEMENTED');
                if (this.distanceMap === null) {
                    // Could not yet create the map based upon the
                    // current bits available
                    return output;
                }
                console.log('distance map', this.distanceMap);
            }

            // TO DO: handle data, break out of current block when 256
            // is found.



            // NOTES:

            // If using dynamic: ...well, we could always error out
            // for now ;)
            // But really:
            // Pull 5 bits into hlit
            // Pull 5 bits into hdist
            // Pull 4 bits into hclen
            // Pull (hclen+4)*3 bits as code lengths, compute code length huffman codes
            // Pull hlit+257 code length huffman codes, compute literal/length huffman codes
            // Pull hdist+1 code length huffman codes, compute distance huffman codes
            // FINALLY: start handling the data
            // End of block when 256 is pulled

            // If using static:
            // Auto-compute the huffman codes
            // Start handling the data
            // End of block when 256 is pulled

            return output;
        },
        createFixedHuffmanMaps: function () {
            // For simplicity (and since this is JS rather than C),
            // using simple JS objects as key/value maps rather than
            // doing binary trees.

            // Create list of value key lengths.
            // The values these map back to are implied by list
            // position.
            var lengths = [];
            var i;
            for (i=0; i<=143; i++) {
                lengths.push(8);
            }
            for (i=144; i<=255; i++) {
                lengths.push(9);
            }
            for (i=256; i<=279; i++) {
                lengths.push(7);
            }
            for (i=280; i<=287; i++) {
                lengths.push(8);
            }
            this.literalLengthMap = this.createMapFromLengths(lengths);

            // Distance codes are 0-31.  In the fixed scheme, they're
            // fixed width at 5 bits.  Since we're using a dict rather
            // than a tree, a simple mapping of values will break
            // unless we can explicitly express that, e.g., there must
            // be 4 leading zeroes before a 1 bit.
            //
            // So...  We'll leave the distanceMap as
            // null, and if we are in fixed mode, we'll just
            // explicitly pull 5 bits.
        },
        createMapFromLengths: function (lengths) {
            var map = {};
            // using RFC 1951 names for some of these variables.

            // Step 1: "Count the number of codes for each code length."
            var bl_count = {};
            var i;
            for (i=0; i<lengths.length; i++) {
                if (lengths[i] in bl_count) {
                    bl_count[lengths[i]] += 1;
                } else {
                    bl_count[lengths[i]] = 1;
                }
            }

            var MAX_BITS = Object.keys(bl_count).sort().slice(-1)[0];
            for (i=1; i<MAX_BITS; i++) {
                if (!(i in bl_count)) {
                    bl_count[i] = 0;
                }
            }

            // Step 2: "Find the numerical value of the smallest code for each code length"
            var next_code = {};
            var code = 0;
            bl_count[0] = 0;
            for (var bits = 1; bits <= MAX_BITS; bits++) {
                code = (code + bl_count[bits-1]) << 1;
                next_code[bits] = code;
            }

            // Step 3: Here we actually create the map.
            var len;
            for (i=0; i<lengths.length; i++) {
                len = lengths[i];
                if (len != 0) {
                    map[i] = next_code[len];
                    next_code[len]++;
                }
            }
            return map;
        },
    };
})();