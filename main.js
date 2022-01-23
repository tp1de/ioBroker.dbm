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
const dbs = [];

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

	await delete_states();

	const pattern = "system.adapter.sql.*.connected";
	const states = await adapter.getForeignStatesAsync(pattern);
	for (const id in states) {dbs.push(id);}

	for (let i=0;i<dbs.length;i++) {
		const state = await adapter.getForeignStateAsync(dbs[i]);
     	if (state.val) {
			const dbss = dbs[i].replace(/.connected/i, "");
			db = dbss.replace(/system.adapter./i, "");
			const obj = await adapter.getForeignObjectAsync(dbss);
			const dbtype = obj.native.dbtype;
			const schema = obj.native.dbname;
			const dbn = dbtype+"-"+db.substring(db.length - 1);
			await init_states(dbn,obj.native);
			await read_mysqlstatus(db,dbn,schema);
		}
	}

	if (!unloaded) adapterIntervals.mysql = setInterval(async function() {
		for (let i=0;i<dbs.length;i++) {
			const state = await adapter.getForeignStateAsync(dbs[i]);
			 if (state.val) {
				const dbss = dbs[i].replace(/.connected/i, "");
				db = dbss.replace(/system.adapter./i, "");
				const obj = await adapter.getForeignObjectAsync(dbss);
				const dbtype = obj.native.dbtype;
				const schema = obj.native.dbname;
				const dbn = dbtype+"-"+db.substring(db.length - 1);
				await read_mysqlstatus(db,dbn,schema);
			}
		}
	}, 3600000); // every hour

	//if (!unloaded) adapter.subscribeStates("*");


}

//--------- functions ---------------------------------------------------------------------------------------------------------


async function init_states(dbn,n) {
	try {
		init_state(dbn+".dbname",n.dbname,"string","database name","");
		init_state(dbn+".host",n.host,"string","host","");
		init_state(dbn+".port",n.port,"number","port","");
		init_state(dbn+".maxConnections",n.maxConnections,"number","maximum connections","");
		init_state(dbn+".encrypt",n.encrypt,"boolean","encryption","");

		init_state(dbn+".size",null,"number","database size","MB");
		init_state(dbn+".ts_number",null,"number","records ts_number","records");
		init_state(dbn+".ts_bool",null,"number","records ts_bool","records");
		init_state(dbn+".ts_count",null,"number","records ts_count","records");
		init_state(dbn+".ts_string",null,"number","records ts_string","records");
		init_state(dbn+".datapoints",null,"number","datapoints","");
		init_state(dbn+".size_ts_number",null,"json","JSON table for no of records per id","");
		init_state(dbn+".innodb",null,"mixed","Recommended_InnoDB_Buffer_Pool_Size","");

	} catch(e) {}
}

async function init_state(state,val,type,name,unit) {
	await adapter.setObjectNotExists(state,{type: "state",common: {type: type, name: name,
		unit: unit, role: "value", read: true, write: false}, native: {}});
	if (val != null ) await adapter.setStateAsync(state, {ack: true, val: val});
}

async function read_mysqlstatus(db,dbn,schema) {

	let q = "SELECT round( Sum( data_length + index_length ) / 1024 / 1024, 3 )";
	q += " as 'result' FROM information_schema.tables where table_schema = '"+schema+"';";
	querystate(db,q,dbn+".size");

	q = "SELECT count(*) as 'result' from "+schema+".ts_number;";
	querystate(db,q,dbn+".ts_number");

	q = "SELECT count(*) as 'result' from "+schema+".ts_bool;";
	querystate(db,q,dbn+".ts_bool");

	q = "SELECT count(*) as 'result' from "+schema+".ts_string;";
	querystate(db,q,dbn+".ts_string");

	q = "SELECT count(*) as 'result' from "+schema+".ts_count;";
	querystate(db,q,dbn+".ts_count");

	q = "SELECT count(*) as 'result' from "+schema+".datapoints";
	querystate(db,q,dbn+".datapoints");

	q = "SELECT CONCAT(CEILING(RIBPS/POWER(1024,pw)),SUBSTR(' KMGT',pw+1,1)) as result";
	q+= " FROM (SELECT RIBPS,FLOOR(LOG(RIBPS)/LOG(1024)) pw FROM ( SELECT SUM(data_length+index_length)*1.1*growth";
	q+= " RIBPS FROM information_schema.tables AAA, (SELECT 1.25 growth) BBB WHERE ENGINE='InnoDB' ) AA ) A;";
	querystate(db,q,dbn+".innodb");

	q = "SELECT ts_number.id as id,datapoints.name as name, count(*) as count, min(FROM_UNIXTIME(`ts_number`.`ts` / 1000)) as min, ";
	q+= "max(FROM_UNIXTIME(`ts_number`.`ts` / 1000)) as max FROM (";
	q+= schema+".ts_number JOIN "+schema+".datapoints) WHERE ts_number.id = datapoints.id ";
	q+= "group by id order by count desc;";
	try {
		adapter.sendTo(db, "query", q, function (result) {
			if (result.error) {adapter.setState(state, {ack: true, val: {}});        }
			else {adapter.setState(dbn+".size_ts_number", {ack: true, val: JSON.stringify(result.result)});}});
	} catch(e) {adapter.log.error(e);}

}

function querystate(db,q,state) {
	try{
		adapter.sendTo(db, "query", q, function (result) {
			if (result.error) {
				adapter.setState(state, {ack: true, val: 0});        }
			else {adapter.setState(state, {ack: true, val: result.result[0].result});}
		});
	} catch(e) {adapter.log.error(e);}
}

async function delete_states() {

	const pattern = adapter.namespace + ".*";
	const states = await adapter.getStatesAsync(pattern);

	for (const id in states) {
		const obj = await adapter.getObjectAsync(id);
		if (obj.common.custom == undefined) await adapter.delObjectAsync(id);
	}
}
