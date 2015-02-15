var InputControl = {
    maxHistory: 100,
    initialize: function (inputElem, client) {
        this.inputElem = inputElem;
        this.client = client;
        this.history = [];
        this.historyIndex = null;
        inputElem.addEventListener('keyup', this.onKeyUp.bind(this));
    },
    focus: function () {
        this.inputElem.focus();
    },
    onKeyUp: function (e) {
        var key = null;
        if (e.key) { // Firefox
            key = e.key;
        } else if (e.keyIdentifier) { // Chrome
            key = e.keyIdentifier;
        }
        if (key === 'Enter') {
            var val = this.inputElem.value;
            this.inputElem.setSelectionRange(0, val.length);
            var shouldSave = this.client.sendInput(val);
            if (shouldSave && 0 < val.trim().length) {
                this.history.push(val);
                while (this.maxHistory < this.history.length) {
                    this.history.shift();
                }
            }
        } else if (key === 'Up') {
            if (this.historyIndex === null) {
                this.historyIndex = 1;
            } else if (this.historyIndex < this.history.length) {
                this.historyIndex += 1;
            } else {
                return;  // No-op
            }
            this.inputElem.value = this.history[this.history.length - this.historyIndex];
        } else if (key === 'Down') {
            if (this.historyIndex === null) {
                // No-op
            } else if (1 < this.historyIndex) {
                this.historyIndex -= 1;
                this.inputElem.value = this.history[this.history.length - this.historyIndex];
            } else {
                this.historyIndex = null;
                this.inputElem.value = '';
            }
        }
    },
};
