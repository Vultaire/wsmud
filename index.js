var debug;

(function () {
    "use strict";

    var onResize = function () {
        var inputDiv = document.querySelector('div.input');
        var outputDiv = document.querySelector('div.output');
        outputDiv.style.height = sprintf(
            "%dpx", window.innerHeight - inputDiv.offsetHeight);
        outputDiv.style.width = sprintf("%dpx", window.innerWidth);
        // Input width: a little trickier due to input box's overflow.
        var inputElem = inputDiv.querySelector('input');
        var widthOffset = inputElem.offsetWidth - inputElem.clientWidth;
        inputDiv.style.width = sprintf("%dpx", window.innerWidth - widthOffset);
    };

    window.addEventListener('resize', function () {
        onResize();
    });
    document.addEventListener('DOMContentLoaded', function () {
        onResize();

        var client = Object.create(Client);
        client.initialize(document.querySelector('div.output'));

        var inputElem = document.querySelector('div.input > input.input');
        var inputControl = Object.create(InputControl);
        inputControl.initialize(inputElem, client);
        inputControl.focus();

        var host = window.prompt('Enter host', 'aardwolf.com');
        var port = window.prompt('Enter port', '11333');
        var url = sprintf("ws://%s:%s/", host, port);

        if (true) {
            var socket = client.connect(url);
            socket.addEventListener('open', function (e) {
                console.log('Web socket opened successfully.');
            });
            socket.addEventListener('error', function (e) {
                alert('Could not open web socket!');
            });
        }
    });
})();