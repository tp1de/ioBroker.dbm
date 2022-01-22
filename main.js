/* eslint-disable no-empty */
//eslint-disable no-empty */
/* eslint-disable no-mixed-spaces-and-tabs */
//"use strict";
//"esversion":"6";

const utils = require("@iobroker/adapter-core");
const adapterName = require("./package.json").name.split(".").pop();

const adapterIntervals = {};
let adapter, unloaded = false;
let db = "sql.0";

// -------------------------------------------------------------------------------------------------------------------------------------------------------------------


function startAdapter(options) {
	options = options || {};
	Object.assign(options, {
		name: adapterName,
		unload: function (callback) {
			unloaded = true;
			try {
				Object.keys(adapterIntervals).forEach(interval => adapter.log.debug("Interval cleared: " + adapterIntervals[interval]));
				Object.keys(adapterIntervals).forEach(interval => clearInterval(adapterIntervals[interval]));
				callback();
			} catch (e) {
				callback();
			}
		},
		ready: function () {
			main();
		},
		stateChange:  (id, state) => {
			if (state && !state.ack) { }
		}
	});
	adapter = new utils.Adapter(options);
	return adapter;
}


// If started as allInOne/compact mode => return function to create instance
if (module && module.parent) {
	module.exports = startAdapter;
} else {
	// or start the instance directly
	startAdapter();
}


//--------- main ---------------------------------------------------------------------------------------------------------

async function main () {

	db = adapter.config.db;

	await delete_states();
	await init_states(db);

	await read_dbstatus(db)

	if (!unloaded) adapter.subscribeStates("*");


}

//--------- functions ---------------------------------------------------------------------------------------------------------


async function init_states(db) {
	try {
		adapter.setObjectNotExists("size",{type: "state",common: {type: "number", name: "test",
			 unit: "mb", role: "value", read: true, write: false}, native: {}});


	} catch(e) {}
}

async function read_dbstatus(db) {

	let q = "SELECT round( Sum( data_length + index_length ) / 1024 / 1024, 3 )";
	q += " as 'DB' FROM information_schema.tables where table_schema = 'iobroker';";

	sendTo(db, "query", q, function (result) {
		if (result.error) {adapter.log.error(result.error);}
		else {
			 const size = result.result.db;
			 adapter.setState("size", {ack: true, val: size});
		}
	});

}


async function delete_states() {

	const pattern = adapter.namespace + ".*";
	const states = await adapter.getStatesAsync(pattern);

	for (const id in states) {
		const obj = await adapter.getObjectAsync(id);
		if (obj.common.custom == undefined) await adapter.delObjectAsync(id);
	}
}
