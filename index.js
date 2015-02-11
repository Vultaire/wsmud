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
                var val = inputElem.value;
                inputElem.value = '';
                client.onUserInput(val);
            }
        });

        var socket = client.connect("ws://localhost:50008/");
        socket.addEventListener('open', function (e) {
            console.log('Web socket open');
        });
        socket.addEventListener('error', function (e) {
            console.log('error: arguments:', arguments);
            alert('Could not open web socket');
        });
    });
})();