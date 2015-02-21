var TelnetFilter;
(function () {

    // TelnetFilter: a base class for telnet filters.
    TelnetFilter = {
        SE: 240,
        NOP: 241,
        DM: 242,   // DM == Data Mar,
        BRK: 243,
        IP: 244,
        AO: 245,
        AYT: 246,
        EC: 247,
        EL: 248,
        GA: 249,
        SB: 250,
        WILL: 251,
        WONT: 252,
        DO: 253,
        DONT: 254,
        IAC: 255,
        initialize: function () {
            this.currentCode = [];
            return this;
        },
        filter: function (socket, buffer) {
            var result = [];
            var i;
            var lastCode;
            var code;
            var handled;
            for (i=0; i<buffer.length; i++) {
                code = buffer[i];
                if (this.currentCode.length === 0) {
                    if (code === this.IAC) {
                        this.currentCode.push(code);
                    } else {
                        result.push(code);
                    }
                } else if (this.currentCode.length === 1) {
                    this.currentCode.push(code);
                    if (code === this.IAC) {
                        // Literal char 255; let it pass through.
                        result.push(code);
                        this.currentCode = [];
                    } else if (241 <= code && code <= 249) {
                        // Handle 2 byte codes
                        console.log('handle 2 byte code');
                        handled = this.onCode(socket);
                        if (!handled) {
                            result = result.concat(this.currentCode);
                        }
                        this.currentCode = [];
                    } else if (250 <= code && code <= 254) {
                        // SB and 3-byte codes; just pushing the byte
                        // is sufficient.  ...which was done above, so
                        // do nothing here.
                    } else {
                        // Either an unexpected SE, or some other
                        // unexpected byte.  Push through unhandled.
                        console.error('Encountered unexpected telneet code',
                                      this.currentCode.slice());
                        result = result.concat(this.currentCode);
                        this.currentCode = [];
                    }
                } else if (this.currentCode.length == 2) {
                    this.currentCode.push(code);
                    if (this.currentCode[1] === this.SB) {
                        // Just keep appending bytes until we
                        // encounter an IAC SE or WILL SE.  (WILL SE
                        // is a special case for handling MCCP version
                        // 1.)
                        // ...already appended; do nothing.
                    } else {
                        // Handle 3 byte codes
                        handled = this.onCode(socket);
                        if (!handled) {
                            result = result.concat(this.currentCode);
                        }
                        this.currentCode = [];
                    }
                } else {
                    // If we get here, we're handling sub-negotiation.
                    this.currentCode.push(code);
                    lastCode = this.currentCode[this.currentCode.length-2];
                    if (
                        (lastCode == this.IAC || lastCode == this.WILL)
                        && code == this.SE
                    ) {
                        // End of subnegotiation detected; handle.
                        handled = this.onCode(socket);
                        if (!handled) {
                            result = result.concat(this.currentCode);
                        }
                        this.currentCode = [];
                    }
                }
            }
            return result;
        },
        onCode: function (socket) {
            // Override in subclasses.
            //
            // Called when a full telnet code has been detected.
            //
            // Return true if this.currentCode was handled and should
            // be stripped from the output, false if the code was not
            // handled and should be passed through.
            console.log('TelnetFilter.onCode:', this.currentCode);
            return false;
        },
    };
})();