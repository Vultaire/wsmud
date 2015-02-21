var AnsiParser;
var Client;

(function () {
    'use strict';
    AnsiParser = {
        // Simple state machine for parsing a subset of ANSI codes.
        initialize: function () {
            this.state = 'normal',
            this.changed = false;
            this.inSpan = false;
            this.outputBuffer = [];
            this.outputMode = {};
            this.ansiCode = null;
            return this;
        },
        getHTML: function (ansiText) {
            var parser = this;
            var handler;
            var result;
            var state;
            this.input = ansiText;
            this.inputIndex = 0;
            while (this.inputIndex < this.input.length) {
                state = this[this.state + 'State'].bind(this);
                state();
            }
            if (this.inSpan) {
                this.outputBuffer.push('</span>');
                this.inSpan = false;
            }
            result = this.outputBuffer.join('');
            this.outputBuffer = [];
            return result;
        },
        normalState: function (code) {
            var code, result, spanClasses;
            while (true) {
                code = this.getNextChar();
                if (typeof code === 'undefined') {
                    return;
                }
                if (code === 27) {
                    this.state = 'ansi';
                    return;
                } else {
                    if (this.changed) {
                        this.changed = false;
                        if (this.inSpan) {
                            this.outputBuffer.push('</span>');
                            this.inSpan = false;
                        }
                        if (0 < Object.keys(this.outputMode).length) {
                            this.inSpan = true;
                            spanClasses = [];
                            if (this.outputMode.fgColor) {
                                spanClasses.push(this.outputMode.fgColor);
                            }
                            if (this.outputMode.fgIntensity) {
                                spanClasses.push('intense');
                            }
                            if (this.outputMode.bgColor) {
                                spanClasses.push(sprintf('bg-%s', this.outputMode.bgColor));
                            }
                            spanClasses = spanClasses.join(' ');
                            this.outputBuffer.push(
                                _.template(
                                    '<span<% if (classes.length > 0) { %> class="<%- classes %>"<% } %>>'
                                )({classes: spanClasses})
                            );
                        }
                    }
                    this.outputBuffer.push(this.escapeChar(String.fromCharCode(code)));
                }
            }
        },
        ansiState: function (code) {
            var ansiCode = [];  // Reminder: ESC (27) has already been received.
            var code;
            while (true) {
                code = this.getNextChar();
                if (typeof code === 'undefined') {
                    return;
                }
                if (ansiCode.length === 0) {
                    if (code === 91) {  // '[' character
                        ansiCode.push(code);
                    } else if (64 <= code && code <= 95) {
                        // Not sure if I need any of these for now.
                        console.error(sprintf('Two character ansi sequence: [27, %d]', code));
                        this.state = 'normal';
                        return;
                    } else {
                        // Wikipedia implies code is invalid.
                        console.error(sprintf('Unexpected ansi sequence: [27, %d]', code));
                        this.state = 'normal';
                        return;
                    }
                } else {
                    ansiCode.push(code);
                    if (64 <= code && code <= 126) {
                        if (code === 109) {
                            this._handleSGR(ansiCode);
                        } else {
                            console.log('ANSI CSI sequence:',
                                        ansiCode.map(String.fromCharCode).join(''));
                        }
                        //console.log('Current output state:', client.ansiState.outputState);
                        this.state = 'normal';
                        return;
                    }
                }
            }
        },
        _handleSGR: function (ansiCode) {
            // Extract params and convert to integers
            var params = ansiCode.slice(1, -1);
            params = params.map(function (charCode) {
                return String.fromCharCode(charCode);
            });
            params = params.join('').split(';');
            if (params.length === 1 && params[0] === '') {
                params = ['0'];
            }
            params = params.map(function (param) {
                return parseInt(param);
            });

            var parser = this;

            var getExtendedColor = function (params, i, fgOrBg) {
                // Sets extended color if found.  Returns the adjusted
                // parsing index, considering the lookahead needed for
                // the different extended color types.
                if (params[i+1] === 5) {
                    if (i+2 < params.length) {
                        var colorClass = sprintf('xterm-%d', params[i+2]);
                        parser.outputMode[fgOrBg + 'Color'] = colorClass;
                    }
                    return i+2;
                } else if (params[i+1] === 2) {
                    var colorCode = sprintf(
                        '#%02X%02X%02X', params[i+2], params[i+3], params[i+4]);
                    console.log('Received 24-bit color code (not yet supported):',
                        colorCode);
                    return i+4;
                } else {
                    console.error('Unexpected extended color prefix:', parser.ansiState.extendedColor[0]);
                    return i+1;
                }
            };

            var i;
            var param;
            for (i=0; i<params.length; i++) {
                param = params[i];
                if (param === 0) {
                    parser.outputMode = {};
                    parser.changed = true;
                } else if (param === 1) {
                    parser.outputMode.fgIntensity = true;
                    parser.changed = true;
                } else if (30 <= param && param <= 37) {
                    // FG colors
                    parser.outputMode.fgColor = parser.getColor(param % 10);
                    parser.changed = true;
                } else if (param === 38) {
                    // FG extended color
                    i = getExtendedColor(params, i, 'fg');
                } else if (param === 39) {
                    delete parser.outputMode.fgColor;
                    parser.changed = true;
                } else if (40 <= param && param <= 47) {
                    // BG colors
                    parser.outputMode.bgColor = parser.getColor(param % 10);
                    parser.changed = true;
                } else if (param === 48) {
                    // BG extended color
                    i = getExtendedColor(params, i, 'bg');
                } else if (param === 49) {
                    delete parser.outputMode.bgColor;
                    parser.changed = true;
                } else {
                    console.log(
                        sprintf(
                            'SGR: %s contains unexpected param at index %d',
                            parser.ansiState.currentCode.map(String.fromCharCode).join('') + 'm',
                            index
                        )
                    );
                }
            }
        },
        getColor: function (i) {
            return {
                0: 'black',
                1: 'red',
                2: 'green',
                3: 'yellow',
                4: 'blue',
                5: 'magenta',
                6: 'cyan',
                7: 'white',
            }[i];
        },
        escapeChar: function (c) {
            // ONLY for use as the *content* of an element.
            // DO NOT USE IN ATTRIBUTES!
            // For more robust escaping: http://wonko.com/post/html-escaping
            if (c === '<') {
                return '&lt;';
            } else if (c === '>') {
                return '&gt;';
            } else {
                return c;
            }
        },
        getNextChar: function () {
            var c = this.input[this.inputIndex];
            this.inputIndex += 1;
            if (typeof c !== 'undefined') {
                return c.charCodeAt(0);
            }
            return c;
        }
    };

    var SE = 240;
    var NOP = 241;
    var DM = 242;   // DM == Data Mark
    var BRK = 243;
    var IP = 244;
    var AO = 245;
    var AYT = 246;
    var EC = 247;
    var EL = 248;
    var GA = 249;
    var SB = 250;
    var WILL = 251;
    var WONT = 252;
    var DO = 253;
    var DONT = 254;
    var IAC = 255;

    var commandMap = {};
    commandMap[SE] = 'SE';
    commandMap[NOP] = 'NOP';
    commandMap[DM] = 'Data Mark';
    commandMap[BRK] = 'BRK';
    commandMap[IP] = 'IP';
    commandMap[AO] = 'AO';
    commandMap[AYT] = 'AYT';
    commandMap[EC] = 'EC';
    commandMap[EL] = 'EL';
    commandMap[GA] = 'GA';
    commandMap[SB] = 'SB';
    commandMap[WILL] = 'WILL';
    commandMap[WONT] = "WON'T";
    commandMap[DO] = 'DO';
    commandMap[DONT] = "DON'T";
    commandMap[IAC] = 'IAC';

    var commandToString = function (command) {
        if (!commandMap.hasOwnProperty(command)) {
            return sprintf('Unknown <%d>', command);
            throw {
                name: 'ValueError',
                message: 'Invalid command detected: ' + command.toString(),
            };
        }
        return commandMap[command];
    };

    Client = {
        socket: null,
        rawFilters: null,
        outputElem: null,
        currentLine: null,
        continueLine: false,
        passwordPrompt: false,
        shouldAutoScroll: true,
        currentCommand: null,
        outputBuffer: null,
        maxBufferLines: 1000,
        ansiParser: null,
        sendMode: 'binary',
        initialize: function (outputElem) {
            this.rawFilters = [];
            this.ansiParser = Object.create(AnsiParser).initialize();
            this.currentCommand = [];
            this.outputBuffer = "";
            this.outputElem = outputElem;
            var client = this;
            this.outputElem.addEventListener('scroll', function () {
                client.shouldAutoScroll = (
                    client.outputElem.scrollTop ===
                        client.outputElem.scrollHeight - client.outputElem.clientHeight
                );
            });
            return this;
        },
        addRawFilter: function (filter) {
            this.rawFilters.push(filter);
        },
        connect: function (addr) {
            //this.socket = new WebSocket(addr, ["telnet"]);

            // For now: not specifying any protocol.  (Might add this
            // back in later; seems right.  But during development,
            // it's convenient to have this off.)
            if (addr.toLowerCase().indexOf('aard') !== -1) {
                // For Aardwolf: use text frames.  (I hope to
                // convince people that binary frames are best for
                // telnet-over-websockets, but for the purpose of
                // development, I'll make this a special case for
                // now.)
                this.sendMode = 'text';
            }
            this.socket = new WebSocket(addr);
            this.socket.addEventListener('message', this.onMessage.bind(this));
            return this.socket;
        },
        sendTelnet: function () {
            if (this.sendMode === 'binary') {
                // implement arraybuffer generation...
            } else {
                // implement string generation...
            }
            // send the generated data struct
        },
        sendInput: function (userInput) {
            /* Sends input to the MUD.

               This function returns true if the input received should
               be retained, and false if it should not (i.e. if this
               input was believed to be in response to a password
               prompt).
            */
            this.socket.send(userInput + '\n');

            // Dunno if we were continuing a previous line, but we
            // aren't now.
            this.continueLine = false;
            this.createNewLine();
            if (this.passwordPrompt) {
                this.appendLine('&nbsp;');  // Hope this won't break later w/ escaping changes...
                return false;
            } else {
                if (userInput.trim().length === 0) {
                    this.appendLine('&nbsp;');  // Hope this won't break later w/ escaping changes...
                } else {
                    this.appendLine(userInput);
                }
                return true;
            }
        },
        onMessage: function (event) {
            var client = this;
            if (event.data.size) {
                // event.data is likely a blob
                var fr = new FileReader();
                fr.addEventListener('loadend', function () {
                    var uint8 = new Uint8Array(fr.result, 0, fr.result.length);
                    client.handleMessage(uint8);
                });
                fr.readAsArrayBuffer(event.data);
            } else {
                // Process Aardwolf style - assume that the unicode
                // code of the characters maps to the desired telnet
                // code.  (Benefit: no messing with encoding and
                // simple string.charCodeAt calls work as expected.
                // Downside: can't use those extended codes under
                // normal circumstances (which may be a non-issue
                // anyway).
                var uint8 = Array.prototype.slice.call(event.data).map(function (c) {
                    return c.charCodeAt(0);
                });
                client.handleMessage(uint8);
            }
        },
        handleMessage: function (buffer) {
            for (var i=0; i<this.rawFilters.length; i++) {
                buffer = this.rawFilters[i].filter(this.socket, buffer);
            }
            buffer = this.fallbackTelnetFilter(buffer);
            var output = String.fromCharCode.apply(null, buffer);
            this.pushOutput(output);
        },
        fallbackTelnetFilter: function (buffer) {
            var rawOutputBuffer = []
            for (var i=0; i<buffer.length; i++) {
                var byte = buffer[i];
                if (this.currentCommand.length === 0) {
                    if (byte === IAC) {
                        this.currentCommand.push(byte);
                    } else {
                        rawOutputBuffer.push(byte);
                    }
                } else {
                    this.currentCommand.push(byte);
                    if (this.currentCommand.length === 2) {
                        if (byte < 240) {
                            // Invalid telnet command
                            console.log(this.currentCommand.map(commandToString));
                            this.currentCommand = [];
                        } else if (240 <= byte && byte <= 250) {
                            // Valid 2-byte telnet command
                            console.log(this.currentCommand.map(commandToString));
                            // TO DO: do something with this ;)
                            this.currentCommand = [];
                        } else if (251 <= byte && byte <= 254) {
                            // Second byte of a 3-byte command; do nothing yet
                        } else if (byte === 255) {
                            // Literal byte 255
                            rawOutputBuffer.push(byte)
                            this.currentCommand = [];
                        }
                    } else if (this.currentCommand.length === 3) {
                        console.log(this.currentCommand.map(commandToString));
                        // TO DO: do something with this ;)
                        this.currentCommand = [];
                    }
                    // Try to interpret command
                }
            }
            return rawOutputBuffer;
        },
        pushOutput: function (output) {
            var client = this;
            // Precede output with any leftover bits from previous packets
            output = client.outputBuffer + output;
            var lines = output.split('\n\r');
            lines.forEach(function (line) {
                var lineElem;
                if (client.continueLine) {
                    lineElem = client.currentLine;
                    client.continueLine = false;
                } else {
                    lineElem = client.createNewLine();
                    if (line.trim().length === 0) {
                        // Workaround for empty lines
                        lineElem.innerHTML = '&nbsp;';
                        return;
                    }
                }
                if (line.charAt(line.length-1) === '\n') {
                    client.outputBuffer = '\n';
                    line = line.slice(0, line.length-2);
                }
                client.appendLine(line);
            });
            // If we ended on a new line, our final line in the
            // line list should be empty.  If this is *not* true,
            // then we should continue from the current line on
            // the next call.
            client.continueLine = lines[lines.length-1] !== '';
        },
        createNewLine: function () {
            var lineElem = document.createElement('div');
            lineElem.classList.add('output-line');
            var shouldScroll = this.shouldAutoScroll;
            while (this.maxBufferLines <= this.outputElem.querySelectorAll('div.output-line').length) {
                this.outputElem.removeChild(this.outputElem.querySelector('div.output-line'));
            }
            this.outputElem.appendChild(lineElem);
            this.currentLine = lineElem;
            if (shouldScroll) {
                // Seems we need to release to the browser to allow redrawing/resizing.
                setTimeout(this.autoScroll.bind(this), 0);
            }
            return lineElem;
        },
        appendLine: function (output) {
            var shouldScroll = this.shouldAutoScroll;
            var coloredOutput = this.ansiParser.getHTML(output);
            this.currentLine.innerHTML += coloredOutput;
            this.detectPasswordPrompt(output);  // Could break on partial packets...
            if (shouldScroll) {
                setTimeout(this.autoScroll.bind(this), 0);
            }
        },
        detectPasswordPrompt: function (output) {
            this.passwordPrompt = (output.toLowerCase().indexOf('password') === 0);
        },
        autoScroll: function () {
            var newScrollTop = this.outputElem.scrollHeight - this.outputElem.clientHeight;
            this.outputElem.scrollTop = this.outputElem.scrollHeight - this.outputElem.clientHeight;
        },
    };
})();
