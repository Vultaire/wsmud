var Client = function () {
    var currentCommand = [];
    var charBuffer = [];

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
        continueLine: false,
        initialize: function (outputElem) {
            this.outputElem = outputElem;
        },
        connect: function (addr) {
            this.socket = new WebSocket(addr, ["telnet"]);
            this.socket.addEventListener('message', this.onMessage.bind(this));
            return this.socket;
        },
        onUserInput: function (userInput) {
            // TO DO: Echo output
            // (Except for password...)
            this.socket.send(userInput + '\n');
        },
        onMessage: function (event) {
            fr = new FileReader();
            var client = this;
            fr.addEventListener('loadend', function () {
                return client.handleMessage(fr.result);
            });
            fr.readAsArrayBuffer(event.data);
        },
        handleMessage: function (buffer) {
            var uint8 = new Uint8Array(buffer, 0, buffer.length);
            for (var i=0; i<uint8.length; i++) {
                var byte = uint8[i];
                if (currentCommand.length === 0) {
                    if (byte === 255) {  // Interpret as Command (IAC)
                        currentCommand.push(byte);
                    } else {
                        charBuffer.push(byte);
                    }
                } else {
                    currentCommand.push(byte);
                    if (currentCommand.length === 2) {
                        if (byte < 240) {
                            // Invalid telnet command
                            console.log(currentCommand.map(commandToString));
                            currentCommand = [];
                        } else if (240 <= byte && byte <= 250) {
                            // Valid 2-byte telnet command
                            console.log(currentCommand.map(commandToString));
                            // TO DO: do something with this ;)
                            currentCommand = [];
                        } else if (251 <= byte && byte <= 254) {
                            // Second byte of a 3-byte command; do nothing yet
                        } else if (byte === 255) {
                            // Literal IAC
                            // TO DO: do something with this ;)
                            // ... likely unneeded for Aard...?
                            currentCommand = [];
                        }
                    } else if (currentCommand.length === 3) {
                        console.log(currentCommand.map(commandToString));
                        // TO DO: do something with this ;)
                        currentCommand = [];
                    }
                    // Try to interpret command
                }
            }
            var output = String.fromCharCode.apply(null, charBuffer);
            charBuffer = [];
            this.pushOutput(output);
        },
        pushOutput: function (output) {
            console.log(output.split('\n\r'));  // For debug and comparison
            var client = this;
            var lines = output.split('\n\r');
            lines.forEach(function (line) {
                console.log([line, line.charCodeAt(0), line.charCodeAt(1), line.charCodeAt(2)]);
                if (!client.continueLine) {
                    lineElem = document.createElement('div');
                    lineElem.classList.add('output-line');
                    client.outputElem.appendChild(lineElem);
                    client.currentLine = lineElem;

                    if (line.trim().length === 0) {
                        // Workaround for empty lines
                        lineElem.innerHTML = '&nbsp;';
                        return;
                    }
                }
                lineElem.innerHTML += _.template('<%- line %>')({line: line});
                // TO DO: determine when to continue a previous line...
            });
        },
    };
}();

