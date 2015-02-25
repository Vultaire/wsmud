var Inflate;

/*

  Devil is in the details:

  "Note that the header bits do not necessarily begin on a byte
  boundary, since a block does not necessarily occupy an integral
  number of bytes."

  So, basically: the entire inflate stream needs to be read
  bit-by-bit.

  Rework required since I assumed blocks would begin on a byte
  boundary.  Seems the only time bits are thrown away is when a
  noncompressed block is encountered.  Anyway, will do the rewrite
  another night.

 */

(function () {
    Inflate = {
        initialize: function () {
            // For zlib frame bytes
            this.zlibBytes = [];
            this.zlibFdict = false;
            // For DEFLATE bytes
            /* Keep track of last 32K bytes for handling back references */
            this.window = new Uint8Array(0x8000);
            this.windowPointer = 0;
            this.handleDataBlockEnd();
            this.errorDetected = false;
            return this;
        },
        handleDataBlockEnd: function () {
            // Reset any state from the previous data block.
            this.blockFinal = null;
            this.blockType = null;
            this.len = null;
            this.nlen = null;
            /* Keep track of any incomplete bits which can't yet be decompressed */
            if (this.remaining && this.remaining.length > 0) {
                console.info('Throwing away remaining bytes:', this.remaining);
            }
            this.remaining = [];

            // Bit gathering stuff
            this.onNewBit = null;
            this.currentBits = [];

            // Common stuff for all huffman code handling
            this.currentLengthValue = null;  // as pulled from huffman code, not the actual length
            this.currentLength = null;
            this.currentDistance = null;  // Not *really* needed, but used for consistency.
            this.literalLengthMap = null;
            this.literalLengthMapMaxBits = null;
            this.distanceMap = null;
            this.distanceMapMaxBits = null;

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
                    if (this.blockType === null) {
                        this.remaining.push(byte);
                        // Beginning of a new data block.
                        this.blockFinal = byte & 0x1;
                        this.blockType = (byte>1) & 0x3;
                        console.log(sprintf('New data block: type: %d, final: %d', this.blockType, this.blockFinal));
                        if (this.blockType === 0) {
                            // Skip remaining bits
                            continue;
                        } else {
                            output = output.concat(this.handleCompressedBits(byte, 3));
                        }
                    } else if (this.blockType === 0) {
                        this.remaining.push(byte);
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
                        output = output.concat(this.handleCompressedBits(byte));
                    }
                }
            }
            return output;
        },
        handleCompressedBits: function (currentByte, currentBit) {
            var output = [];
            if (typeof currentBit === 'undefined') {
                currentBit = 0;
            }

            // May be good to rework this first bit to use the new bit
            // push loop as well...  Maybe later.

            if (this.literalLengthMap === null) {
                if (this.blockType === 1) {
                    this.createFixedHuffmanMaps();

                    // Next step will be actually reading codes;
                    // transition to the appropriate parsers.
                    this.transitionBitParser(
                        this.getHuffmanFunction(
                            this.literalLengthMap, this.literalLengthMapMaxBits),
                        this.onLiteralLength.bind(this)
                    );
                } else {
                    throw {name: 'NotImplementedError'};
                }
                if (this.literalLengthMap === null) {
                    // Could not yet create the map based upon the
                    // current bits available
                    return output;
                }
                //console.log('literal/length map', this.literalLengthMap);
            }
            if (this.distanceMap === null && this.blockType === 2) {
                throw {name: 'NotImplementedError'};

                // Don't forget to adjust bits after implementing, if needed.
                if (this.distanceMap === null) {
                    // Could not yet create the map based upon the
                    // current bits available
                    return output;
                }
                //console.log('distance map', this.distanceMap);

                // Next step will be actually reading codes;
                // transition to the appropriate parsers.
                this.transitionBitParser(
                    this.getHuffmanFunction(
                        this.literalLengthMap, this.literalLengthMapMaxBits),
                    this.onLiteralLength.bind(this)
                );
            }

            // Handle data, break out of current block when 256 is
            // found.
            // NOTE: This works great for static encoding, but may be
            // problematic when using dynamic encoding.  Think about
            // this later.
            var value;
            var outputChunk;
            var currentBitValue;
            for (; currentBit<8; currentBit++) {
                currentBitValue = (currentByte >> currentBit) & 0x1;
                this.currentBits.push(currentBitValue);
                try {
                    value = this.onNewBit();
                } catch (e) {
                    console.error(e);
                    this.errorDetected = true;
                    return output;
                }
                if (value !== null) {
                    try {
                        outputChunk = this.onValue(value);
                    } catch (e) {
                        if (e.name === 'EndOfBlock') {
                            console.log('Detected end of block');
                            this.handleDataBlockEnd();
                        } else {
                            console.error(e);
                            this.errorDetected = true;
                        }
                        // Discard any remaining bits and return
                        // current output.
                        return output;
                    }

                    if (outputChunk) {
                        this.pushWindowBytes(outputChunk);
                        output = output.concat(outputChunk);
                    }
                }
            }

            // NOTES:

            // If using dynamic: ...well, we could always error out
            // for now ;)
            // But really:
            // Pull 5 bits into hlit.  (Assert that hlit is 29; not sure of behavior otherwise.)
            // Pull 5 bits into hdist.  (Assert that hdist is 31; not sure of behavior otherwise.)
            // Pull 4 bits into hclen.  (Assert that hclen is 15; not sure of behavior otherwise.)
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
            var lengths;
            var i;
            var mapAndMax;

            lengths = [];
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
            mapAndMax = this.createMapFromLengths(lengths);
            this.literalLengthMap = mapAndMax[0];
            this.literalLengthMapMaxBits = mapAndMax[1];

            lengths = [];
            for (i=0; i<=31; i++) {
                lengths.push(5);
            }
            mapAndMax = this.createMapFromLengths(lengths);
            this.distanceMap = mapAndMax[0];
            this.distanceMapMaxBits = mapAndMax[1];
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
        pushWindowByte: function (byte) {
            this.window[this.windowPointer] = byte;
            this.windowPointer = (this.windowPointer + 1) % 0x10000;
        },
        pushWindowBytes: function (bytes) {
            bytes.forEach(this.pushWindowByte.bind(this));
        },
        getPastBytes: function (length, distance) {
            var result = [];
            var pastPointer = (this.windowPointer + 0x10000 - distance) % 0x10000;
            for (var i=0; i<length; i++) {
                result.push(this.window[pastPointer]);
                pastPointer = (pastPointer + 1) % 0x10000;
            }
            return result;
        },
        computeBitsValue: function (bits) {
            var bitsVal = 0;
            for (var i=0; i<bits.length; i++) {
                bitsVal = (bitsVal << 1) + bits[i];
            }
            return bitsVal;
        },
        getHuffmanFunction: function (map, maxBits) {
            var that = this;
            return function () {
                var huffman = '';
                that.currentBits.forEach(function (bit) {
                    huffman += bit;
                });
                if (map.hasOwnProperty(huffman)) {
                    return map[huffman];
                } else if (that.currentBits.length === maxBits) {
                    throw {
                        name: 'ValueError',
                        message: 'Could not extract value based on Huffman code',
                    };
                } else {
                    return null;
                }
            };
        },
        getBitsFunction: function (bits) {
            var that = this;
            return function () {
                if (that.currentBits.length === bits) {
                    return that.computeBitsValue(that.currentBits);
                }
                return null;
            };
        },
        onLiteralLength: function (value) {
            if (value <= 255) {
                console.log(sprintf('Detected literal: %s (%d)',
                                    String.fromCharCode(value), value));
                // Keep same parser, just reset the bits
                this.currentBits = [];
                return [value];
            } else if (value === 256) {
                throw {name: 'EndOfBlock'};
            } else {
                if (257 <= value && value <= 264) {
                    this.currentLength = value - 254;
                    this.transitionBitParser(
                        this.getHuffmanFunction(
                            this.distanceMap, this.distanceMapMaxBits),
                        this.onDistance.bind(this)
                    );
                } else if (value === 285) {
                    this.currentLength = 258;
                    this.currentBits = [];
                    this.transitionBitParser(
                        this.getHuffmanFunction(
                            this.distanceMap, this.distanceMapMaxBits),
                        this.onDistance.bind(this)
                    );
                } else {
                    this.currentLengthValue = value;
                    var bitsNeeded = Math.floor((value - 261) / 4);
                    this.transitionBitParser(
                        this.getBitsFunction(bitsNeeded),
                        this.onLengthBits.bind(this)
                    );
                }
                return null;
            }
        },
        onLengthBits: function (value) {
            this.currentLength = this.baseLengthMap[this.currentLengthValue] + value;
            this.transitionBitParser(
                this.getHuffmanFunction(
                    this.distanceMap, this.distanceMapMaxBits),
                this.onDistance.bind(this)
            );
        },
        onDistance: function (value) {
            if (value <= 3) {
                this.currentDistance = value + 1;
                output = this.getPastBytes(this.currentLength, this.currentDistance);
                this.transitionBitParser(
                    this.getHuffmanFunction(
                        this.literalLengthMap, this.literalLengthMapMaxBits),
                    this.onLiteralLength.bind(this)
                );
                console.log('Returning past bytes', output);
                return output;
            } else {
                // bits needed
                this.currentDistanceValue = value;
                var bitsNeeded = Math.floor((value - 2) / 2);
                this.transitionBitParser(
                    this.getBitsFunction(bitsNeeded),
                    this.onDistanceBits.bind(this)
                );
                return null;
            }
        },
        onDistanceBits: function (value) {
            this.currentDistance = this.baseDistanceMap[this.currentDistanceValue] + value;
            output = this.getPastBytes(this.currentLength, this.currentDistance);
            this.transitionBitParser(
                this.getHuffmanFunction(
                    this.literalLengthMap, this.literalLengthMapMaxBits),
                this.onLiteralLength.bind(this)
            );
            console.log('Returning past bytes', output);
            return output;
        },
        transitionBitParser: function (onNewBit, onValue) {
            this.currentBits = [];
            this.onNewBit = onNewBit;
            this.onValue = onValue;
        },
    };

    // Avoid errors in transposing from the RFCs: programatically
    // generate the value-length and value-distance lookup tables.

    var i, extraBits;
    Inflate.baseLengthMap = {};
    Inflate.baseLengthMap[256] = 2;  // Just for calculation purposes
    for (i=257; i<=284; i++) {
        extraBits = Math.max(Math.floor(((i-1)-261) / 4), 0);
        Inflate.baseLengthMap[i] = (
            Inflate.baseLengthMap[i-1] + Math.pow(2, extraBits)
        );
    }
    delete Inflate.baseLengthMap[256];
    Inflate.baseLengthMap[285] = 258;

    Inflate.baseDistanceMap = {};
    Inflate.baseDistanceMap[-1] = 0;  // Just for calculation purposes
    for (i=0; i<=29; i++) {
        extraBits = Math.max(Math.floor(((i-1)-2) / 2), 0);
        Inflate.baseDistanceMap[i] = Inflate.baseDistanceMap[i-1] + Math.pow(2, extraBits);
    }
    delete Inflate.baseDistanceMap[-1];

})();