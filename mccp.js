var MCCPFilter;

(function () {
    'use strict';

    MCCPFilter = _.extend(Object.create(TelnetFilter), {
        COMPRESS: 85,
        COMPRESS2: 86,
        initialize: function () {
            TelnetFilter.initialize.call(this);
            this.serverWillCompress2 = false;
            this.compress = false;
            return this;
        },
        filter: function (socket, buffer) {
            if (this.compress) {
                // decompress
                // pass through as-is
                return buffer;
            } else {
                return TelnetFilter.filter.call(this, socket, buffer);
            }
        },
        onCode: function (socket) {
            if (this.currentCode[0] == this.IAC
                && this.currentCode[1] == this.WILL
                && this.currentCode[2] == this.COMPRESS2) {

                this.serverWillCompress2 = true;

                // Request MCCP version 2
                var buff = new ArrayBuffer(3);
                var uint8 = new Uint8Array(buff);
                uint8[0] = this.IAC;
                uint8[1] = this.DO;
                uint8[2] = this.COMPRESS2;
                socket.send(buff);
            }
            else if (this.currentCode[0] == this.IAC
                && this.currentCode[1] == this.WILL
                && this.currentCode[2] == this.COMPRESS) {

                // Conditionally request MCCP version 1 (if version 2
                // is not enabled)
                // NOTE: Untested!
                var buff = new ArrayBuffer(3);
                var uint8 = new Uint8Array(buff);
                uint8[0] = this.IAC;
                uint8[1] = this.serverWillCompress2 ? this.DONT : this.DO;
                uint8[2] = this.COMPRESS;
                socket.send(buff);
            } else if (this.currentCode[0] == this.IAC
                && this.currentCode[1] == this.SB
                && this.currentCode[2] == this.COMPRESS2
                && this.currentCode[3] == this.IAC
                && this.currentCode[4] == this.SE) {

                // MCCP version 2 enabled
                this.compress = true;
            } else if (this.currentCode[0] == this.IAC
                && this.currentCode[1] == this.SB
                && this.currentCode[2] == this.COMPRESS
                && this.currentCode[3] == this.WILL
                && this.currentCode[4] == this.SE) {

                // MCCP version 1 enabled
                this.compress = true;
            } else {
                return false;
            }
            return true;
        },
    });
})();