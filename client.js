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
        onUserInput: function (userInput) {
            this.socket.send(userInput + '\n');

            if (!this.passwordPrompt) {
                // Dunno if we were continuing a previous line, but we
                // aren't now.
                this.continueLine = false;
                this.createNewLine();
                this.appendLine(userInput);
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
                            // Literal IAC
                            // TO DO: do something with this ;)
                            // ... likely unneeded for Aard...?
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
                var lineElem = client.currentLine;
                if (!lineElem || !client.continueLine) {
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
            console.log('Continue line:', client.continueLine);
            // Something seems bugged... test via "clan -h".  Lots of
            // output == weirdness.  Haven't yet traced.
        },
        createNewLine: function () {
            var lineElem = document.createElement('div');
            lineElem.classList.add('output-line');
            var shouldScroll = this.shouldAutoScroll;
            this.outputElem.appendChild(lineElem);
            this.currentLine = lineElem;
            if (shouldScroll) {
                // Seems we need to release to the browser to allow redrawing/resizing.
                setTimeout(this.autoScroll.bind(this), 0);
            }
            return lineElem;
        },
        appendLine: function (input) {
            var shouldScroll = this.shouldAutoScroll;
            this.currentLine.innerHTML += _.template('<%- input %>')({input: input});
            this.detectPasswordPrompt(input);
            if (shouldScroll) {
                setTimeout(this.autoScroll.bind(this), 0);
            }
        },
        detectPasswordPrompt: function (input) {
            this.passwordPrompt = (input.toLowerCase().indexOf('password') === 0);
        },
        autoScroll: function () {
            // TO DO: Don't autoscroll if the user scrolls up from the
            // bottom.
            var newScrollTop = this.outputElem.scrollHeight - this.outputElem.clientHeight;
            this.outputElem.scrollTop = this.outputElem.scrollHeight - this.outputElem.clientHeight;
        },
    };
}();
