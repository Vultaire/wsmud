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

  ----------------------------------------------------------------------

  Creating code length huffman table:

  First, create list of 20 lengths.  Include 0 lengths (i.e. "skipped"
  values).

  How do these get created?

  1. Create list of lengths.
     - Count the lengths of everything.
     - if all the lengths are zero, then there will be no codes; 0 should be skipped.

  2. Check for oversubscription...  (I don't do this)
     left = 1
     for i in range(1, maxbits+1):
       left <<= 1  (becomes 2 on first loop through)
       left -= count[i]  (e.g. if count[i] is 2 on the first loop, then there's exactly 2 codes; if 1 or less, then we're good.)
       if left < 0: ERROR

  3. Create offsets into symbol table...
     off[1] = 0
     off[2] = off[1] + count[1]
     off[3] = off[2] + count[2]
     etc.
     (C-specific, likely not relevant for me.)

  4. Create the symbol mapping
     For each symbol (0...n-1):
       if the length is *not* zero,
       then the symbol is set to the next value for the offset in question.

  Basically, this seems the same as my code.

  HMM... but maybe there's another bit here.  Maybe tweaking the map
  with overrides is the wrong thing; maybe we need to do the overrides
  based upon the output values of the map?

  My code trims the magic values by filtering out any zeroes...  maybe
  the effect is the same here?  Maybe this changes nothing?  ...but I
  think the C code is simpler; I think I'll adopt its methodology.

  ERM... wait a sec... the C code *does* do something w/ the order bits.

  - First: my copy of the list is identical to the C copy; no problem
    there.

  - Second: the conversion is done *before* going into the huffman
    map.  This also in theory is the same as my code, but I'm not 100%
    sure I haven't missed some small nuance.  ...Regardless, I like
    the C code better; let's adopt it.

 ...did the above changes; getting the same error.  Nothing obvious is
 jumping at me here.  Meh...

 */

(function () {
    var isSet = function (val) {
        return (val !== null && typeof val !== 'undefined');
    };

    // Magic sequence for code length values used for dynamic huffman
    // encoding.  The ordering is as defined here.
    var codeLengthValues = [
        16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15
    ];

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
            this.codeLengthMap = null;
            this.codeLengthMapMaxBits = null;
            this.lastLength = null;
            this.repetitionValue = null;
            this.repetitionBaseCount = null;
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
                        //console.log('onByte result:', onByteResult);
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
                        //console.log('Value detected; current bits:', this.currentBits,
                        //            'value:', extractedValue)
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
                    this.getBitsFunction(14),
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
                    console.log('Upcoming uncompressed bytes, count:', this.len);
                    this.onByte = this.handleDeflateUncompressedBytes;
                } else {
                    // I didn't expect this would happen, but if my
                    // parser is working right, I'm definitely seeing
                    // it.  Will check len vs nlen to make sure.
                    console.log('Received zero-length uncompressed block.');
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
            this.hlit = value & 0x1f;
            this.hdist = (value >> 5) & 0x1f;
            this.hclen = (value >> 10) & 0xf;
            console.log('hlit:', this.hlit);
            console.log('hdist:', this.hdist);
            console.log('hclen:', this.hclen);

            this.transitionBitParser(
                this.getBitsFunction(this.hclen * 3, true),
                this.onDynamicHuffmanCodeLengths.bind(this)
            );
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
        onDynamicHuffmanCodeLengths: function (value) {
            // Compute code length code lengths :)
            // value is simply "true", so pull from currentBits.

            // ...Lengths are out of order.  Let's map them to the
            // correct values, then put them in order.
            var lengthMap = {};
            var i;
            for (i=0; i<this.hclen; i++) {
                lengthMap[codeLengthValues[i]] = this.computeBitsValue(
                    this.currentBits.slice(i*3, (i+1)*3));
            }
            for (i=this.hclen; i<19; i++) {
                lengthMap[codeLengthValues[i]] = 0
            }
            lengths = []
            for (i=0; i<19; i++) {
                lengths.push(lengthMap[i]);
            }

            // Compute code length huffman codes
            var mapAndMax = this.createMapFromLengths(lengths);
            this.codeLengthMap = mapAndMax[0];
            this.codeLengthMapMaxBits = mapAndMax[1];

            // Start pulling code lengths for literals/lengths and
            // distances.
            this.transitionBitParser(
                this.getHuffmanFunction(
                    this.codeLengthMap, this.codeLengthMapMaxBits),
                this.onCodeLength.bind(this)
            );

        },
        onCodeLength: function (value) {
            // convert value to one or more lengths
            console.log('onCodeLength:', value);
            if (0 <= value && value <= 15) {
                // pass; we'll handle it below.
                console.log('Exact code:', value);
            } else if (value === 16) {
                if (this.lastLength === null) {
                    throw {
                        name: 'RuntimeError',
                        message: 'Received a dynamic code length of 16, but no previous code length exists to repeat.'
                    };
                } else {
                    this.repetitionValue = this.lastLength;
                    this.repetitionBaseCount = 3;
                    this.transitionBitParser(
                        this.getBitsFunction(2),
                        this.onCodeLengthRepetition.bind(this)
                    );
                    return;
                }
            } else if (value === 17) {
                this.repetitionValue = 0;
                this.repetitionBaseCount = 3;
                this.transitionBitParser(
                    this.getBitsFunction(3),
                    this.onCodeLengthRepetition.bind(this)
                );
                return;
            } else if (value === 18) {
                this.repetitionValue = 0;
                this.repetitionBaseCount = 11;
                this.transitionBitParser(
                    this.getBitsFunction(7),
                    this.onCodeLengthRepetition.bind(this)
                );
                return;
            } else {
                throw {
                    name: 'ValueError',
                    message: 'Unexpected value received',
                    value: value,
                };
            }
            // If we're not done, we don't change state.  No real need
            // to do anything with addDynamicLength's return value
            // here.
            this.lastLength = value;
            this.addDynamicLengths([value]);
            this.currentBits = [];
        },
        onCodeLengthRepetition: function (value) {
            var repetitions = value + this.repetitionBaseCount;
            var lengths = [];
            for (var i=0; i<repetitions; i++) {
                lengths.push(this.repetitionValue);
            }
            console.log('Repetition:', lengths);
            this.lastLength = this.repetitionValue;
            var done = this.addDynamicLengths(lengths);
            if (!done) {
                // Transition back to pulling code length huffman codes
                this.transitionBitParser(
                    this.getHuffmanFunction(
                        this.codeLengthMap, this.codeLengthMapMaxBits),
                    this.onCodeLength.bind(this)
                );
            }
        },
        addDynamicLengths: function (lengths) {
            // append the lengths
            console.log('Adding dynamic lengths:', lengths);
            for (var i=0; i<lengths.length; i++) {
                if (this.literalLengthCodeLengths.length < this.hlit) {
                    console.log('Adding lit/len code');
                    this.literalLengthCodeLengths.push(lengths[i]);
                } else if (this.distanceCodeLengths.length < this.hdist) {
                    console.log('Adding distance code');
                    this.distanceCodeLengths.push(lengths[i]);
                } else {
                    console.log('Literal/length code list dump:', this.literalLengthCodeLengths);
                    console.log('Distance code list dump:', this.distanceCodeLengths);
                    throw {
                        name: 'RuntimeError',
                        message: 'Unexpected: extra code lengths detected for dynamic huffman decoding',
                        value: lengths.slice(i),
                    };
                }
            }

            var mapAndMax;
            if (this.hlit === this.literalLengthCodeLengths.length &&
                this.hdist === this.distanceCodeLengths.length) {

                console.log('Adding dynamic lengths:', lengths);
                // Generate our dynamic maps
                mapAndMax = this.createMapFromLengths(this.literalLengthCodeLengths);
                this.literalLengthMap = mapAndMax[0];
                this.literalLengthMapMaxBits = mapAndMax[1];

                mapAndMax = this.createMapFromLengths(this.distanceCodeLengths);
                this.distanceMap = mapAndMax[0];
                this.distanceMapMaxBits = mapAndMax[1];

                // Transition to pulling compressed data
                this.transitionBitParser(
                    this.getHuffmanFunction(
                        this.literalLengthMap, this.literalLengthMapMaxBits),
                    this.onLiteralLength.bind(this)
                );
                // Return true: we're done and have already taken care
                // of the next transition.
                console.log('Done creating dynamic huffman tables!');
                return true;
            }
            // Return false: we're not done, no transition has been done yet.
            console.log('Not done yet');
            console.log('Current lit/len code count:', this.literalLengthCodeLengths.length);
            console.log('Current distance code count:', this.distanceCodeLengths.length);
            return false;
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

            var MAX_BITS = parseInt(Object.keys(bl_count).sort().slice(-1)[0]);
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
        getPastBytes: function (length, distance) {
            // NOT DOCUMENTED in RFC1951 as far as I can tell;
            // apparently length can exceed distance.  Basically, it
            // seems the intent is that bytes being added to the
            // buffer *during* the copy process are also included.
            //
            // This is a little hard to explain, so more concretely:
            // let's say the last byte I have is "#".  Let's say I
            // have length 12, distance 1.  The first byte I copy is
            // obviously "#".  What about 2-12?  After copying the
            // first byte, my back buffer has one extra character (the
            // second #), and that provides index 2 with a value.
            // Likewise for 3-12.
            //
            // Because of this (in my opinion) inadequately documented
            // behavior, the implementation here gets a little
            // interesting.  Plus, unlike with literals, we *will*
            // muck with our window buffer directly.  We need to make
            // sure that our callers also handle this well...

            // windowPointer is the next input position, *not* the last byte.
            var result = [];
            var pastPointer = (this.windowPointer + 0x10000 - distance) % 0x10000;
            var byte;
            for (var i=0; i<length; i++) {
                byte = this.window[pastPointer];
                result.push(byte);
                this.pushWindowByte(byte);
                pastPointer = (pastPointer + 1) % 0x10000;
            }
            return result;
        },
        computeBitsValue: function (bits) {
            // bits: 01001
            // lsb-first value: 18
            // msb-first value: 9
            // manual runthrough:
            /*
              bitsVal = 0

              i = 5-1 => 4
              val = bits[4] => 1
              bitsVal = (0<<1) + 1 => 1

              i = 5-1 => 3
              val = bits[3] => 0
              bitsVal = (1<<1) + 0 => 2

              i = 5-1 => 2
              val = bits[2] => 0
              bitsVal = (2<<1) + 0 => 4

              i = 5-1 => 1
              val = bits[1] => 1
              bitsVal = (4<<1) + 1 => 9

              i = 5-1 => 0
              val = bits[0] => 0
              bitsVal = (9<<1) + 0 => 18
             */
            // looks correct...
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
                    console.log(sprintf(
                        'huffman code "%s" returning value %d',
                        huffman, map[huffman]));
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
        getBitsFunction: function (bits, booleanOnly) {
            // Note about "extra bits" accompanying huffman codes:
            //
            // RFC says:
            // Generally packed least-significant to most-significant.
            // Huffman codes explicitly are most-significant to least-significant.
            //
            // Based on experimentation: Extra bits are alongside the
            // huffman codes, but are *not* the huffman codes, so use
            // LSB->MSB ordering.
            //
            // HOWEVER, the RFC says this, at least with regards to
            // lengths: "The extra bits should be interpreted as a
            // machine integer stored with the most-significant bit
            // first, e.g., bits 1110 represent the value 14."
            //
            // Concretely observed on Aardwolf was that my distance
            // code was coming through with an extra bits value being
            // read as 24, when the actual intent was 3.  When I
            // switched to LSB-first, this went away.
            //
            // I sense craziness somewhere, but hopefully it's just in
            // my own head...
            //
            // TO DO: Look at reference decompressor puff.c, and use
            // to correct/finish my implementation.
            //
            // (Would be good to later document perceived
            // underdocumented or undocumented gotchas on a blog
            // post.)
            //
            // UPDATE: It seems there *is* a contradiction between the
            // RFC and reality.  Not only does my code not work if I
            // follow the RFC's MSB->LSB ordering, but puff.c, the
            // reference implementation decompressor, also follows
            // LSB->MSB.

            // SO link regarding dynamic huffman encoding:
            // http://stackoverflow.com/questions/10472526/dynamic-huffman-encoding-on-deflate-rfc-1951

            var that = this;
            return function () {
                if (that.currentBits.length === bits) {
                    if (booleanOnly) {
                        return true;
                    } else {
                        return that.computeBitsValue(that.currentBits);
                    }
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
                this.pushWindowByte(value);
                return [value];
            } else if (value === 256) {
                this.handleDataBlockEnd();
            } else {
                console.log('Length value (raw)', value);
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
            console.log('Value from bits:', value, 'Bits:', this.currentBits);
            console.log('Computed length:', this.currentLength);
            this.transitionBitParser(
                this.getHuffmanFunction(
                    this.distanceMap, this.distanceMapMaxBits),
                this.onDistance.bind(this)
            );
        },
        onDistance: function (value) {
            console.log('Distance value (raw)', value);
            if (value <= 3) {
                this.currentDistance = value + 1;
                output = this.getPastBytes(this.currentLength, this.currentDistance);
                this.transitionBitParser(
                    this.getHuffmanFunction(
                        this.literalLengthMap, this.literalLengthMapMaxBits),
                    this.onLiteralLength.bind(this)
                );
                console.log('Returning past bytes', output.map(function (code) {
                    return String.fromCharCode(code);
                }));
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
            console.log('Value from bits:', value, 'Bits:', this.currentBits);
            console.log('Computed length:', this.currentLength);
            output = this.getPastBytes(this.currentLength, this.currentDistance);
            this.transitionBitParser(
                this.getHuffmanFunction(
                    this.literalLengthMap, this.literalLengthMapMaxBits),
                this.onLiteralLength.bind(this)
            );
            console.log('Returning past bytes', output.map(function (code) {
                return String.fromCharCode(code);
            }));
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