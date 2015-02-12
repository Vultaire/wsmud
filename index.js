var debug;

(function () {
    "use strict";

    var onResize = function () {
        var inputDiv = document.querySelector('div.input');
        var outputDiv = document.querySelector('div.output');
        // I don't like the 5 pixel offsets...
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
        var client = Object.create(Client);
        client.initialize(document.querySelector('div.output'));
        var inputElem = document.querySelector('div.input > input.input');
        inputElem.addEventListener('keyup', function (e) {
            var shouldSend = false;
            if (e.key) { // Firefox
                shouldSend = (e.key == 'Enter');
            } else if (e.keyIdentifier) { // Chrome
                shouldSend = (e.keyIdentifier == 'Enter');
            }
            if (shouldSend) {
                inputElem.setSelectionRange(0, inputElem.value.length);
                client.onUserInput(inputElem.value);
            }
        });
        onResize();
        inputElem.focus();

        if (true) {
        var socket = client.connect("ws://localhost:50008/");
        socket.addEventListener('open', function (e) {
            console.log('Web socket opened successfully.');
        });
        socket.addEventListener('error', function (e) {
            alert('Could not open web socket!');
        });
        }
    });
})();