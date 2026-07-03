import { n as __name } from "./chunk-Y2CYZVJY-DUN_E3Zt.js";
var ImperativeState = class {
	constructor(init) {
		this.init = init;
		this.records = this.init();
	}
	static #_ = __name(this, "ImperativeState");
	reset() {
		this.records = this.init();
	}
};
export { ImperativeState as t };
