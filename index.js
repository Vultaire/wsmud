(function () {
    document.addEventListener('DOMContentLoaded', function () {
        var client = Object.create(Client);
        client.initialize();
        var socket = new WebSocket("ws://localhost:50008/", ["telnet"])
        socket.addEventListener('open', function (e) {
            console.log('Web socket open');
        });
        socket.addEventListener('error', function (e) {
            console.log('error: arguments:', arguments);
            alert('Could not open web socket');
        });
        socket.addEventListener('message', client.onMessage.bind(client))
    });
})();