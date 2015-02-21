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
    MCCPFilter = _.extend(Object.create(TelnetFilter), {
        initialize: function () {
            TelnetFilter.initialize.call(this);
            this.serverWillCompress = false;
            this.serverWillCompress2 = false;
            this.compress = false;
            return this;
        },
        onCode: function (socket) {
            console.log('MCCPFilter.onCode:', this.currentCode);
            return false;
        },
    });
})();