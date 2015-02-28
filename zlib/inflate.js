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
    var isSet = function (val) {
        return (val !== null && typeof val !== 'undefined');
    };

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
            this.onByte = this.handleZlibByte;
            return this;
        },
        handleDataBlockEnd: function () {
            console.log('Resetting for new data block');
            // Reset any state from the previous data block.
            this.blockFinal = null;
            this.blockType = null;

            // Bit gathering stuff
            this.currentBits = [];
            // getValue is called each time a bit is added; it returns
            // null unless a valid value is detected, then it returns
            // that value.
            this.getValue = this.getBlockType;
            // onValue handles the value extracted via getValue.  This
            // also is where these two functions tend to get
            // reassigned (in other words, when state machine
            // "transitions" occur).
            this.onValue = this.onBlockType;

            // For uncompressed blocks
            this.len = null;
            this.nlen = null;
            this.sizeBytes = [];
            this.bytesRead = 0;

            // Common stuff for all huffman code handling
            this.currentLengthValue = null;  // as pulled from huffman code, not the actual length
            this.currentLength = null;
            this.currentDistance = null;  // Not *really* needed, but used for consistency.
            this.literalLengthMap = null;
            this.literalLengthMapMaxBits = null;
            this.distanceMap = null;
            this.distanceMapMaxBits = null;

            // For handling dynamic huffman codes
            this.hlit = 0;
            this.hdist = 0;
            this.hclen = 0;
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
            var onByteResult;
            for (i=0; i<input.length; i++) {
                if (this.errorDetected) {
                    // Again, if an error occurs, just spit the output
                    // out unprocessed.
                    return Array.prototype.slice.call(input, i);
                }
                byte = input[i];
                try {
                    onByteResult = this.onByte(byte);
                    if (onByteResult && (0 < onByteResult.length)) {
                        console.log('onByte result:', onByteResult);
                        output = output.concat(onByteResult);
                    }
                } catch (e) {
                    this.error(e);
                }
            }
            return output;
        },
        handleZlibByte: function (byte) {
            this.zlibBytes.push(byte);
            if (this.zlibBytes.length === 1) {
                // Current byte is CMF
                console.log(sprintf(
                    'zlib CMF byte: CM: %d, CINFO: %d',
                    byte & 0xf, (byte>>4) & 0xf
                ));
            } else if (this.zlibBytes.length === 2) {
                // Current byte is FLG
                console.log(sprintf(
                    'zlib FLG byte: FCHECK: %d, FDICT: %d, FLEVEL: %d',
                    byte & 0x1f, (byte>>5) & 0x1, (byte>>6) & 0x3
                ));
                this.zlibFdict = (byte>>5) & 0x1;
                // If FDICT is false, transition to the DEFLATE
                // stream.
                if (!this.zlibFdict) {
                    this.onByte = this.handleDeflateBits;
                    // No further setup needed; the other state
                    // variables should already be ready for the first
                    // data block.
                } else {
                    console.error('Unexpected: zlib fdict flag is true');
                }
            } else if (this.zlibFdict && this.zlibBytes.length == 6) {
                // The final 4 bytes, if present, are for the fdict
                // hash if I recall right.  We'll just ignore them,
                // then transition to the DEFLATE stream.
                this.onByte = this.handleDeflateBits;
                // No further setup needed; the other state variables
                // should already be ready for the first data block.
            } else {
                throw {name: 'RuntimeError', message: 'Should never get here'};
            }
        },
        handleDeflateBits: function (byte) {
            var output = [];
            var currentBitValue;
            var extractedValue;
            var outputChunk;
            for (var currentBit=0; currentBit<8; currentBit++) {
                currentBitValue = (byte >> currentBit) & 0x1;
                this.currentBits.push(currentBitValue);
                try {
                    extractedValue = this.getValue();
                } catch (e) {
                    this.error(e);
                    return output;
                }
                if (isSet(extractedValue)) {
                    try {
                        console.log('Value detected; current bits:', this.currentBits,
                                    'value:', extractedValue)
                        outputChunk = this.onValue(extractedValue);
                    } catch (e) {
                        if (e.name === 'SkipRemainingBits') {
                            break;
                        } else {
                            this.error(e);
                        }
                        // Discard any remaining bits and return
                        // current output.
                        return output;
                    }

                    if (outputChunk && (0 < outputChunk.length)) {
                        this.pushWindowBytes(outputChunk);
                        output = output.concat(outputChunk);
                    }
                }
            }
            return output;
        },
        getBlockType: function () {
            var blockType;
            if (this.currentBits.length === 3) {
                this.blockFinal = this.currentBits[0];
                blockType = this.currentBits[1] + (this.currentBits[2] << 1);
                if (0 <= blockType && blockType <= 2) {
                    return blockType;
                } else {
                    this.error('Unexpected block type', blockType);
                }
            }
        },
        onBlockType: function (value) {
            if (value === 0) {
                this.sizeBytes = [];
                this.onByte = this.handleDeflateUncompressedSize;
                throw {name: 'SkipRemainingBits'};
            } else if (value === 1) {
                // Static huffman codes: create fixed maps, then start
                // parsing compressed data.
                this.createFixedHuffmanMaps();
                this.transitionBitParser(
                    this.getHuffmanFunction(
                        this.literalLengthMap, this.literalLengthMapMaxBits),
                    this.onLiteralLength.bind(this)
                );
            } else if (value === 2) {
                // Dynamic huffman codes: work to be done here.
                this.transitionBitParser(
                    this.getBitsFunctionLE(14),
                    this.onDynamicHuffmanFirst14Bits.bind(this)
                );
            } else {
                this.error("shouldn't get here", value);
            }
        },
        handleDeflateUncompressedSize: function (byte) {
            this.sizeBytes.push(byte);
            if (this.sizeBytes.length === 4) {
                this.len = this.sizeBytes[0] + (this.sizeBytes[1] << 8);
                this.nlen = this.sizeBytes[2] + (this.sizeBytes[3] << 8);
                if (this.len ^ 0xFFFF !== this.nlen) {
                    console.error('Length mismatch: len:', this.len, 'nlen:', this.nlen);
                }
                if (0 < this.len) {
                    console.log('upcoming uncompressed bytes, count:', this.len);
                    this.onByte = this.handleDeflateUncompressedBytes;
                } else {
                    // I didn't expect this would happen, but if my
                    // parser is working right, I'm definitely seeing
                    // it.  Will check len vs nlen to make sure.
                    console.log('Zero bytes in uncompressed block; resetting to next data block.');
                    this.onByte = this.handleDeflateBits;
                    this.handleDataBlockEnd();
                }
            }
        },
        handleDeflateUncompressedBytes: function (byte) {
            this.bytesRead += 1;
            this.pushWindowByte(byte);
            if (this.bytesRead === this.len) {
                this.onByte = this.handleDeflateBits;
                this.handleDataBlockEnd();
            }
            return [byte];
        },
        onDynamicHuffmanFirst14Bits: function (value) {
            var this.hlit = value & 0x1f;
            var this.hdist = (value >> 5) & 0x1f;
            var this.hclen = (value >> 10) & 0xf;
            console.log('Dynamic huffman first 3 fields:',
                        this.hlit, this.hdist, this.hclen);
            this.error('Unimplemented and stuff; erroring out');
            // Reminder of order of code length alphabet encodings:
            // 16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2,
            // 14, 1, 15

            // Getting hlit of 14, hdist of 18, hclen of 12.  Maps to
            // 271 lit/length codes, 19 hdist codes and 16 code length
            // codes.  Doesn't match my expectations, as anything less
            // than the max values doesn't give me enough info on how
            // to implement this per RFC 1951.  (The dynamic
            // compression section does not seem to provide enough
            // information.)

            // I wonder if I am making some sort of parsing mistake...
            // At the same time, if I log in, then reconnect, it
            // doesn't kick me over to dynamic huffman, yet I have
            // some character corruption.  I think there is a bug
            // elsewhere which needs to be fixed first...  Then maybe
            // the "weirdness" I see here *might* vanish...  If I'm
            // lucky.
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
        computeBitsValueBE: function (bits) {
            // Computes bits in big endian order (MSB first)
            var bitsVal = 0;
            for (var i=0; i<bits.length; i++) {
                bitsVal = (bitsVal << 1) + bits[i];
            }
            return bitsVal;
        },
        computeBitsValueLE: function (bits) {
            // Computes bits in little endian order (MSB last)
            var bitsVal = 0;
            for (var i=bits.length-1; 0<=i; i--) {
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
        getBitsFunctionBE: function (bits) {
            var that = this;
            return function () {
                if (that.currentBits.length === bits) {
                    return that.computeBitsValueBE(that.currentBits);
                }
                return null;
            };
        },
        getBitsFunctionLE: function (bits) {
            var that = this;
            return function () {
                if (that.currentBits.length === bits) {
                    return that.computeBitsValueLE(that.currentBits);
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
                this.handleDataBlockEnd();
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
                        this.getBitsFunctionBE(bitsNeeded),
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
                    this.getBitsFunctionBE(bitsNeeded),
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
        transitionBitParser: function (getValue, onValue) {
            this.currentBits = [];
            this.getValue = getValue;
            this.onValue = onValue;
        },
        error: function () {
            this.errorDetected = true;
            console.error.apply(console, arguments);
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