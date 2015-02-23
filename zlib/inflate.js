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
            this.errorDetected = false;
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
            // Common stuff for all huffman code handling
            this.literalLengthMap = null;
            this.literalLengthMapMaxBits = null;
            // Store current huffman code; do << 1 + bit for each new bit.
            this.currentHuffman = null;
            this.currentHuffmanBits = null;

            // For handling dynamic huffman codes
            this.hlit = null;
            this.hdist = null;
            this.hclen = null;
            this.codeLengthCodeLengths = [];
            this.codeLengthMap = null;
            this.literalLengthCodeLengths = [];
            this.distanceCodeLengths = [];
            // Distance codes are fixed 5 bit fields with fixed
            // huffman encoding, but use huffman encoding when using
            // dynamic huffman codes.
            this.distanceMap = null;
            this.distanceMapMaxBits = null;
        },
        push: function (input) {
            if (this.errorDetected) {
                // If an error occurs, just spit the output out
                // unprocessed.  (Not much we can do; we don't know
                // whether we can correctly detect end of the block or
                // anything if we encounter errors.)
                return input;
            }
            var i;
            var byte;
            var output = [];
            for (i=0; i<input.length; i++) {
                if (this.errorDetected) {
                    // Again, if an error occurs, just spit the output
                    // out unprocessed.
                    return input.slice(i);
                }
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
                    //console.log('DEFLATE byte:', byte);
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
                            output = output.concat(this.handleCompressedBits(3));
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
            }
            return output;
        },
        handleCompressedBits: function (currentBit) {
            var output = [];
            if (typeof currentBit === 'undefined') {
                currentBit = 0;
            }

            if (this.literalLengthMap === null) {
                if (this.blockType === 1) {
                    this.createFixedHuffmanMaps();
                    // Next step will be actually reading codes; go
                    // ahead and reset the current code.
                    this.resetHuffmanCode();
                } else {
                    console.error('NOT IMPLEMENTED');
                    // Don't forget to adjust bits after implementing, if needed.
                }
                if (this.literalLengthMap === null) {
                    // Could not yet create the map based upon the
                    // current bits available
                    return output;
                }
                //console.log('literal/length map', this.literalLengthMap);
            }
            if (this.distanceMap === null && this.blockType === 2) {
                console.error('NOT IMPLEMENTED');
                // Don't forget to adjust bits after implementing, if needed.
                if (this.distanceMap === null) {
                    // Could not yet create the map based upon the
                    // current bits available
                    return output;
                }
                console.log('distance map', this.distanceMap);
            }

            // Handle data, break out of current block when 256 is
            // found.
            // NOTE: This works great for static encoding, but may be
            // problematic when using dynamic encoding.  Think about
            // this later.
            var currentByte = this.remaining[this.remaining.length-1];
            var huffmanStr;
            var value;
            for (; currentBit<8; currentBit++) {
                this.pushHuffmanBit((currentByte >> currentBit) & 0x1);
                huffmanStr = this.getHuffmanBitString();
                if (this.literalLengthMap.hasOwnProperty(huffmanStr)) {
                    value = this.literalLengthMap[huffmanStr];
                    this.resetHuffmanCode();
                    if (value <= 255) {
                        console.log(sprintf('Detected literal: %s (%d)',
                                            String.fromCharCode(value), value));
                        output.push(value);
                    }
                    if (value === 256) {
                        // End of data block
                        console.log('Detected end of block');
                        return output;
                    }
                    if (256 < value) {
                        console.log('Detected special code...', value);
                    }
                } else if (this.currentHuffmanBits === this.literalLengthMapMaxBits) {
                    console.error('Could not extract value based on Huffman code.');
                    console.error('Current Huffman value:', this.currentHuffman);
                    console.error('Current Huffman bits:', this.currentHuffmanBits);
                    console.error('Literal/Length Huffman map:', this.literalLengthMap);
                    this.errorDetected = true;
                    return output;
                }
            }


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
            var mapAndMax = this.createMapFromLengths(lengths);
            this.literalLengthMap = mapAndMax[0];
            this.literalLengthMapMaxBits = mapAndMax[1];

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

            /*
              ACK; I was mistaken.  Huffman codes are truly being
              generated in a binary tree fashion, where e.g. 011 is
              clearly distinct from 11.

              Alternate methodologies:

              - Use nested {0: ..., 1:...} objects to literally
                represent a tree.

              - Convert the ints to strings, and use the bit sequence
                converted to a string as the key.

              I'm going to try the latter.
             */

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
            var len, huffman;
            for (i=0; i<lengths.length; i++) {
                len = lengths[i];
                if (len != 0) {
                    huffman = sprintf('%0' + len + 'b', next_code[len]);
                    map[huffman] = i;
                    next_code[len]++;
                }
            }
            return [map, MAX_BITS];
        },
        resetHuffmanCode: function () {
            this.currentHuffman = 0;
            this.currentHuffmanBits = 0;
        },
        getHuffmanBitString: function () {
            return sprintf('%0' + this.currentHuffmanBits + 'b', this.currentHuffman);
        },
        pushHuffmanBit: function (bit) {
            this.currentHuffman = (this.currentHuffman << 1) + bit;
            this.currentHuffmanBits += 1;
        },
    };
})();