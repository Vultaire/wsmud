(function () {
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

        var socket = client.connect("ws://localhost:50008/");
        socket.addEventListener('open', function (e) {
            console.log('Web socket opened successfully.');
        });
        socket.addEventListener('error', function (e) {
            alert('Could not open web socket!');
        });
    });
})();