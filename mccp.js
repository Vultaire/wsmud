var MCCPFilter;

(function () {
    'use strict';

    var COMPRESS = 85;
    var COMPRESS2 = 86;
    var SB = 250;
    var WILL = 251;
    var DO = 253;
    var DONT = 254;
    var IAC = 255;

    // Drop this... make a base class for pulling telnet codes, then
    // specialize for MCCP.
    MCCPFilter = {
        initialize: function () {
            this.compress = false;
            this.currentCode = [];
            return this;
        },
        filter: function (socket, buffer) {
            var result = [];
            var i;
            if (!this.compress) {
                for (i=0; i<buffer.length; i++) {
                    var code = buffer[i];
                    result.push(code);
                }
            } else {
                // Once we get here, we just decompress the data and
                // spit it through; no further need to inspect each
                // byte.

                // TO DO
                throw {name: 'NotImplementedError'};
            }
            return result;
        },
    };
})();