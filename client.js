var Client = function () {
    'use strict';

    var commandMap = {
        240: 'SE',
        241: 'NOP',
        242: 'Data Mark',
        243: 'BRK',
        244: 'IP',
        245: 'AO',
        246: 'AYT',
        247: 'EC',
        248: 'EL',
        249: 'GA',
        250: 'SB',
        251: 'WILL',
        252: "WON'T",
        253: 'DO',
        254: "DON'T",
        255: 'IAC',
    };

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

    return {
        socket: null,
        outputElem: null,
        currentLine: null,
        continueLine: false,  // Probably not used so often with MUDs...
        passwordPrompt: false,
        shouldAutoScroll: true,
        currentCommand: null,
        outputBuffer: null,
        maxBufferLines: 1000,
        ansiState: {
            parsing: false,
            currentCode: [],
            outputState: {},
        },
        initialize: function (outputElem) {
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
        },
        connect: function (addr) {
            this.socket = new WebSocket(addr, ["telnet"]);
            this.socket.addEventListener('message', this.onMessage.bind(this));
            return this.socket;
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
                return false;
            } else {
                this.appendLine(userInput);
                return true;
            }
        },
        onMessage: function (event) {
            var fr = new FileReader();
            var client = this;
            fr.addEventListener('loadend', function () {
                return client.handleMessage(fr.result);
            });
            fr.readAsArrayBuffer(event.data);
        },
        handleMessage: function (buffer) {
            var rawOutputBuffer = []
            var uint8 = new Uint8Array(buffer, 0, buffer.length);
            for (var i=0; i<uint8.length; i++) {
                var byte = uint8[i];
                if (this.currentCommand.length === 0) {
                    if (byte === 255) {  // Interpret as Command (IAC)
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
            var output = String.fromCharCode.apply(null, rawOutputBuffer);
            this.pushOutput(output);
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
            var coloredOutput = this.getColoredOutput(output);
            this.currentLine.innerHTML += coloredOutput;
            this.detectPasswordPrompt(output);  // Could break on partial packets...
            if (shouldScroll) {
                setTimeout(this.autoScroll.bind(this), 0);
            }
        },
        getColoredOutput: function (output) {
            /*
              - Track current ANSI "state".
              - For each ANSI code encountered:
                - Update the state.
                - Close the previous span (if needed)
              - For each normal character encountered:
                - Open a new span based on the current state (if needed)
                - Append the HTML-escaped character
             */
            var result = [];
            var i, c;
            var client = this;
            var inSpan = false;
            for (i=0; i<output.length; i++) {
                c = output.charCodeAt(i);
                if (!client.ansiState.parsing) {
                    if (c === 27) {
                        client.ansiState.parsing = true;
                        client.ansiState.currentCode = [];
                    } else {
                        if (client.ansiState.changed === true) {
                            client.ansiState.changed = false;
                            if (inSpan) {
                                result.push('</span>');
                            }
                            if (0 < Object.keys(client.ansiState.outputState).length) {
                                inSpan = true;
                                // TO DO: Create the *real* span.
                                var spanClasses = [];
                                if (client.ansiState.outputState.fgColor) {
                                    spanClasses.push(client.ansiState.outputState.fgColor);
                                }
                                if (client.ansiState.outputState.fgIntensity) {
                                    spanClasses.push('intense');
                                }
                                if (client.ansiState.outputState.bgColor) {
                                    spanClasses.push(sprintf('bg-%s', client.ansiState.outputState.bgColor));
                                }
                                spanClasses = spanClasses.join(' ');
                                result.push(
                                    _.template(
                                        '<span<% if (classes.length > 0) { %> class="<%- classes %>"<% } %>>'
                                    )({classes: spanClasses})
                                );
                            }
                        }
                        // TO DO: close previous span if needed
                        // TO DO: open new span if needed
                        result.push(client.escapeChar(String.fromCharCode(c)));
                    }
                } else {
                    if (client.ansiState.currentCode.length === 0) {
                        if (c === 91) {  // [
                            client.ansiState.currentCode.push(c);
                        } else if (64 <= c && c <= 95) {
                            // Not sure if I need any of these for now.
                            console.error(sprintf('Two character ansi sequence: [27, %d]', c));
                        } else {
                            // Wikipedia implies client is invalid.
                            console.error(sprintf('Unexpected ansi sequence: [27, %d]', c));
                        }
                    } else {
                        if (64 <= c && c <= 126) {
                            if (c === 109) {  // m ("SGR - Select Graphic Rendition")
                                var params = client.ansiState.currentCode.slice(1);
                                params = params.map(function (charCode) {return String.fromCharCode(charCode)});
                                params = params.join('').split(';');
                                if (params.length === 1 && params[0] === '') {
                                    params = ['0'];
                                }
                                params.forEach(function (param, index) {
                                    param = parseInt(param);
                                    if (param === 0) {
                                        client.ansiState.outputState = {};
                                    } else if (param === 1) {
                                        client.ansiState.outputState.fgIntensity = true;
                                    } else if (30 <= param && param <= 37) {
                                        // FG colors
                                        client.ansiState.outputState.fgColor = client.getColor(param % 10);
                                    } else if (param === 39) {
                                        delete client.ansiState.outputState.fgColor;
                                    } else if (40 <= param && param <= 47) {
                                        // BG colors
                                        client.ansiState.outputState.bgColor = client.getColor(param % 10);
                                    } else if (param === 49) {
                                        delete client.ansiState.outputState.bgColor;
                                    } else {
                                        console.log(
                                            sprintf(
                                                'SGR: %s contains unexpected param at index %d',
                                                client.ansiState.currentCode.map(String.fromCharCode).join('') + 'm',
                                                index
                                            )
                                        );
                                    }
                                });
                                client.ansiState.changed = true;
                            } else {
                                client.ansiState.currentCode.push(c);
                                console.log('ANSI CSI sequence:',
                                            client.ansiState.currentCode.map(String.fromCharCode).join(''));
                            }
                            //console.log('Current output state:', client.ansiState.outputState);
                            client.ansiState.parsing = false;
                        } else {
                            client.ansiState.currentCode.push(c);
                        }
                    }
                }
            }
            if (inSpan) {
                result.push('</span>');
            }
            return result.join('');
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
        detectPasswordPrompt: function (output) {
            this.passwordPrompt = (output.toLowerCase().indexOf('password') === 0);
        },
        autoScroll: function () {
            var newScrollTop = this.outputElem.scrollHeight - this.outputElem.clientHeight;
            this.outputElem.scrollTop = this.outputElem.scrollHeight - this.outputElem.clientHeight;
        },
    };
}();
