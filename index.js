var debug;

(function () {
    "use strict";

    var onResize = function () {
        var menuDiv = document.querySelector('div.menu');
        var outputDiv = document.querySelector('div.output');
        var inputDiv = document.querySelector('div.input');
        outputDiv.style.height = sprintf(
            "%dpx", window.innerHeight - menuDiv.offsetHeight - inputDiv.offsetHeight);
        outputDiv.style.width = sprintf("%dpx", window.innerWidth);
        // Input width: a little trickier due to input box's overflow.
        var inputElem = inputDiv.querySelector('input');
        var widthOffset = inputElem.offsetWidth - inputElem.clientWidth;
        inputDiv.style.width = sprintf("%dpx", window.innerWidth - widthOffset);
    };

    window.addEventListener('resize', function () {
        onResize();
    });

    var initMenus = function () {
        initMenu('div.menu > span.file', '#file-menu');
        initMenu('div.menu > span.help', '#help-menu');
    };

    var initMenu = function (parentSelector, bodySelector) {
        // Basically need to do this for each menu.  Refactor later.
        var menu = document.querySelector(parentSelector);
        var menuShown = false;
        menu.addEventListener('click', function () {
            if (!menuShown) {
                menuShown = true;
                var $menuPopup = jQuery(bodySelector);

                // TO DO: Maybe set a class or style on the menu
                // element?  To ensure it stays "down", or to disable
                // highlighting on hover (doesn't exist yet), or to
                // otherwise render it slightly differently than
                // normal?

                // Show the menu
                $menuPopup.menu();
                $menuPopup.css('position', 'absolute');
                $menuPopup.css('top', (menu.offsetTop + menu.offsetHeight) + 'px');
                $menuPopup.css('left', menu.offsetLeft + 'px');
                $menuPopup.removeClass('hidden');
            }
        });

        // TO DO: Add help menu...
    };

    document.addEventListener('DOMContentLoaded', function () {
        onResize();
        initMenus();

        var client = Object.create(Client).initialize(
            document.querySelector('div.output'));
        client.addRawFilter(Object.create(MCCPFilter).initialize());

        var inputElem = document.querySelector('div.input > input.input');
        var inputControl = Object.create(InputControl);
        inputControl.initialize(inputElem, client);
        inputControl.focus();

        if (false) {
            //var host = window.prompt('Enter host', 'aardwolf.com');
            //var port = window.prompt('Enter port', '11333');
            var host = window.prompt('Enter host', 'localhost');
            var port = window.prompt('Enter port', '4000');
            var url = sprintf("ws://%s:%s/", host, port);

            var socket = client.connect(url);
            socket.addEventListener('open', function (e) {
                console.log('Web socket opened successfully.');
            });
            socket.addEventListener('close', function (e) {
                alert('The connection was closed.');
            });
            socket.addEventListener('error', function (e) {
                alert('Could not open web socket!');
            });
        }
    });
})();