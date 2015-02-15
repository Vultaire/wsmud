var InputControl = {
    initialize: function (inputElem, client) {
        this.inputElem = inputElem;
        this.client = client;
        inputElem.addEventListener('keyup', this.onKeyUp.bind(this));
    },
    focus: function () {
        this.inputElem.focus();
    },
    onKeyUp: function (e) {
        var shouldSend = false;
        if (e.key) { // Firefox
            shouldSend = (e.key == 'Enter');
        } else if (e.keyIdentifier) { // Chrome
            shouldSend = (e.keyIdentifier == 'Enter');
        }
        if (shouldSend) {
            this.inputElem.setSelectionRange(0, this.inputElem.value.length);
            this.client.sendInput(this.inputElem.value);
        }
    },
};