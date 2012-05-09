(function (window, document, undefined) {
	var ReadyList = function () {
		this.queueLength = 0;
		this.list = {};
	};

	ReadyList.prototype.exists = function (name) {
		return (typeof this.list[name] !== 'undefined');
	};

	ReadyList.prototype.createList = function (name) {
		if (this.exists(name)) return false;

		this.list[name] = {
			'data' : {}, 
			'callbacks' : [], 
			'ready' : false, 
			'busy' : false
		};

		return true;
	};

	ReadyList.prototype.data = function (name, selector) {
		if (!this.exists(name)) return null;
		if (!selector) return this.list[name].data;

		var data = this.list[name].data;
		return eval('data.' + selector);
	};

	ReadyList.prototype.isBusy = function (name) {
		if (!this.exists(name)) return null;
		return (this.list[name].busy === true);
	};

	ReadyList.prototype.busy = function (name, busy) {
		if (!this.exists(name)) return null;
		this.list[name].busy = busy;
	};

	ReadyList.prototype.isReady = function (name) {
		if (!this.exists(name)) return null;
		return (this.list[name].ready === true);
	};

	ReadyList.prototype.ready = function (name, ready) {
		if (!this.exists(name)) return null;
		this.list[name].ready = ready;
		this.execute(name);
	};

	ReadyList.prototype.add = function (name, create, callback) {
		if (create) this.createList(name);
		if (!this.exists(name)) return false;

		this.list[name].callbacks.push(callback);
		this.queueLength++;
		this.execute(name);
	};

	ReadyList.prototype.execute = function (name) {
		if (!this.exists(name)) return false;
		if (!this.isReady(name)) return;

		var self = this;
		var callbacks = this.list[name].callbacks;
		for (var callback; callback = callbacks.pop();) {
			(function (cb) {
				if (typeof cb === 'function') {
					setTimeout(function () {
						cb(self.data(name));

						self.queueLength--;
					}, 0);
				}
			})(callback);
		}
	};

	window.ReadyList = ReadyList;

})(window, document);
