var ReadyList = function () {
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
		'ready' : false
	};

	return true;
};

ReadyList.prototype.data = function (name, selector) {
	if (!this.exists(name)) return null;
	if (!selector) return this.list[name].data;

	var data = this.list[name].data;
	return eval('data.' + selector);
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
	this.execute(name);
};

ReadyList.prototype.execute = function (name) {
	if (!this.exists(name)) return false;
	if (!this.isReady(name)) return;

	var callbacks = this.list[name].callbacks;
	for (var callback; callback = callbacks.pop();) {
		if (typeof callback === 'function') {
			callback(this.data(name));
		}
	}
};

exports.ReadyList = ReadyList;
