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

    var MenuBar = function () {
        this.currentMenu = null;
    };
    MenuBar.prototype.initMenus = function () {
        var menuBar = this;
        ['file', 'edit', 'help'].forEach(function (label) {
            menuBar.initMenu(label);
        });
    };
    MenuBar.prototype.initMenu = function (label) {
        var menuBar = this;
        var parentSelector = sprintf('div.menu > span.%s', label);
        var bodySelector = sprintf('div.menu > ul.%s-menu', label);

        // Grab the menubar label
        var menuElem = document.querySelector(parentSelector);

        // Create the jQuery UI menu object
        var $menuPopup = jQuery(bodySelector);
        $menuPopup.menu();
        $menuPopup.css('position', 'absolute');
        // Adjust top offset by 5 for bottom padding of menubar
        $menuPopup.css(
            'top',
            (menuElem.offsetTop + menuElem.offsetHeight + 5) + 'px');
        // adjust left offset by 5 for left padding of menubar
        $menuPopup.css(
            'left',
            (menuElem.offsetLeft - 5) + 'px');

        // Wire the menu to the menu bar
        menuElem.$popup = $menuPopup;

        menuElem.addEventListener('click', function (e) {
            if (!menuBar.currentMenu) {
                menuBar.currentMenu = e.target;

                // TO DO: Maybe set a class or style on the menu
                // element?  To ensure it stays "down", or to disable
                // highlighting on hover (doesn't exist yet), or to
                // otherwise render it slightly differently than
                // normal?

                // Show the menu
                $menuPopup.removeClass('hidden');
            } else {
                menuBar.currentMenu.$popup.addClass('hidden');
                menuBar.currentMenu = null;
            }
        });
        menuElem.addEventListener('mouseover', function (e) {
            if (menuBar.currentMenu && menuBar.currentMenu !== e.target) {
                // hide previous menu
                menuBar.currentMenu.$popup.addClass('hidden');
                menuBar.currentMenu = null;
                // show new menu
                menuBar.currentMenu = e.target;
                menuBar.currentMenu.$popup.removeClass('hidden');
            }
        });
    };

    document.addEventListener('DOMContentLoaded', function () {
        onResize();
        var menuBar = new MenuBar();
        menuBar.initMenus();

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