const _ = require('lodash');
const LogEntry = require('./log_entry');
const debug = require('debug')('bte:biothings-explorer-trapi:edge-manager');

module.exports = class EdgeManager {
    constructor(edges) {
        // flatten list of all edges available
        this.edges = _.flatten(Object.values(edges));;
        this.logs = [];
        this.results = [];
        this.init();
    }

    init() {
        debug(`(3) Edge manager will manage ${this.edges.length} edges.`);
        this.logs.push(
            new LogEntry(
                'DEBUG',
                null,
                `Edge manager will manage ${this.edges.length} edges.`,
            ).getLog(),
        );
    }

    getNext() {
        //returns next edge with lowest entity count on
        //either object or subject OR no count last
        
        // available not yet executed
        let available_edges = this.edges
        .filter(edge => !edge.executed);
        //safeguard for making sure there's available
        //edges when calling getNext
        if (available_edges.length == 0) {
            debug(`(5) Error: ${available_edges} available edges found.`);
            this.logs.push(
                new LogEntry(
                    'DEBUG',
                    null,
                    `Edge manager cannot get next edge, ` +
                    `(${available_edges} )available edges found.`,
                ).getLog(),
            );
        }
        //begin search
        let next;
        let lowest_entity_count;
        let current_obj_lowest = 0;
        let current_sub_lowest = 0;
        available_edges.forEach((edge) => {
            if (
                edge && 
                edge.object_entity_count
                ) {
                current_obj_lowest = edge.object_entity_count;
                if (!lowest_entity_count) {
                    //set current lowest if none
                    lowest_entity_count = current_obj_lowest;
                }
                if (current_obj_lowest <= lowest_entity_count) {
                    //lowest is now object count
                    next = edge;
                }
            }
            if (
                edge && 
                edge.subject_entity_count &&
                edge.subject_entity_count > 0
                ) {
                current_sub_lowest = edge.subject_entity_count;
                if (!lowest_entity_count) {
                    //set current lowest if none
                    lowest_entity_count = current_sub_lowest;
                }
                if (current_sub_lowest <= lowest_entity_count) {
                    //lowest is now subject count
                    next = edge;
                }
            }
        });
        if (!next) {
            //if no edge with count found pick the first empty
            //edge available
            let all_empty = available_edges
            .filter((edge) => !edge.object_entity_count && !edge.subject_entity_count);
            if (all_empty.length == 0) {
                debug(`(5) Error: No available edges found.`);
                this.logs.push(
                    new LogEntry(
                        'DEBUG',
                        null,
                        `Cannot get next edge, No available edges found.`,
                    ).getLog(),
                );
            }
            debug(`(5) Sending next edge '${all_empty[0].getID()}' with NO entity count.`);
            return this.preSendOffCheck(all_empty[0]);
        }
        debug(`(5) Sending next edge '${next.getID()}' ` +
        `WITH entity count...(${next.subject_entity_count || next.object_entity_count})`);
        return this.preSendOffCheck(next);
    }

    logEntityCounts() {
        this.edges.forEach((edge) => {
            debug(`"${edge.getID()}"` +
            ` : (${edge.subject_entity_count || 0}) ` +
            `${edge.reverse ? '<--' : '-->'}` +
            ` (${edge.object_entity_count || 0})`);
        });
    }

    refreshEdges() {
        //this can be used to trigger a refresh of class attrs
        debug(`(9) Refreshing edges...`);
        //update edges entity counts
        this.edges.forEach(edge => edge.updateEntityCounts());
    }

    preSendOffCheck(next) {
        //if at the time of being queried the edge has both
        //obj and sub entity counts
        if (next.requires_entity_count_choice) {
             //chose obj/suj lower entity count for query
            next.chooseLowerEntityValue();
            this.logs.push(
                new LogEntry('DEBUG', 
                null, 
                `Next edge will pick lower entity value to use for query.`).getLog(),
            );
        }
        this.logs.push(
            new LogEntry('DEBUG', 
            null, 
            `Edge manager is sending next edge ${next.getID()} for execution.`).getLog(),
        );
        this.logEntityCounts();
        return next;
    }

    getEdgesNotExecuted() {
        //simply returns a number of edges not marked as executed
        let found = this.edges.filter(edge => !edge.executed);
        let not_executed = found.length;
        if(not_executed) debug(`(4) Edges not yet executed = ${not_executed}`);
        return not_executed;
    }

    _reduceEdgeResultsWithNeighborEdge(edge, neighbor) {
        let first = edge.results;
        let second = neighbor.results;
        debug(`(9) Received (${first.length}) & (${second.length}) results...`);
        this.logs.push(
            new LogEntry(
                'DEBUG',
                null,
                `Edge manager will try to intersect ` +
                `(${first.length}) & (${second.length}) results`,
            ).getLog(),
        );
        let results = [];
        let dropped = 0;
        //find semantic type of one edge in the other edge
        //it can be output or input
        //that's the entity connecting them, then compare
        //(G)---((CS)) and ((G))----(D)
        //CS is output in first edge and input on second
        //FIRST
        first.forEach((f) => {
        let first_semantic_types = f.$input.obj;
        first_semantic_types = first_semantic_types.concat(f.$output.obj);

        first_semantic_types.forEach((f_type) => {
            //SECOND
            second.forEach((s) => {
            let second_semantic_types = s.$input.obj;
            second_semantic_types = second_semantic_types.concat(s.$output.obj);

            second_semantic_types.forEach((s_type) => {
                //compare types
                if (f_type._leafSemanticType == s_type._leafSemanticType) {
                    //type match 

                    //collect first ids
                    let f_ids = new Set();
                    for (const prefix in f_type._dbIDs) {
                        f_ids.add(prefix + ':' + f_type._dbIDs[prefix])
                    }
                    f_ids = [...f_ids];
                    //collect second ids
                    let s_ids = new Set();
                    for (const prefix in s_type._dbIDs) {
                        s_ids.add(prefix + ':' + s_type._dbIDs[prefix])
                    }
                    s_ids = [...s_ids];
                    //compare ids and keep if match in both
                    let sharesID = _.intersection(f_ids, s_ids).length;
                    if (sharesID) {
                        results.push(f);
                    }
                }
            });
            });
        });
        });
        dropped = first.length - results.length;
        debug(`(9) "${edge.getID()}" Kept (${results.length}) / Dropped (${dropped})`);
        this.logs.push(
            new LogEntry(
                'DEBUG',
                null,
                `Edge manager is intersecting results for ` +
                `"${edge.getID()}" Kept (${results.length}) / Dropped (${dropped})`,
            ).getLog(),
        );
        if (results.length === 0) {
            this.logs.push(
                new LogEntry(
                    'DEBUG',
                    null,
                    `After intersection of "${edge.getID()}" and` +
                    ` "${neighbor.getID()}" edge manager got 0 results.`,
                ).getLog(),
            );
        }
        return results;
    }

    gatherResults_OLD() {
        //go through edges and collect all results
        debug(`Collecting results...`);
        this.edges.forEach((edge, index, array) => {
            let neighbor = array[index + 1];
            if ( neighbor !== undefined) {
                let current = this._reduceEdgeResultsWithNeighborEdge(edge, neighbor);
                edge.storeResults(current);
                let next = this._reduceEdgeResultsWithNeighborEdge(neighbor, edge);
                neighbor.storeResults(next);
                debug(`"${edge.getID()}" keeps (${current.length}) results!`);
                debug(`"${neighbor.getID()}" keeps (${next.length}) results!`);
                this.logs.push(
                    new LogEntry(
                        'DEBUG',
                        null,
                        `"${edge.getID()}" keeps (${current.length}) results and` +
                        `"${neighbor.getID()}" keeps (${next.length}) results!`,
                    ).getLog(),
                );
            }
        });
        this.edges.forEach((edge) => {
            edge.results.forEach((r) => {
                this.results.push(r);
            });
        });
        debug(`Collected (${this.results.length}) results!`);
        this.logs.push(
            new LogEntry(
                'DEBUG',
                null,
                `Edge manager collected (${this.results.length}) results!`
            ).getLog(),
        );
    }

    _filterEdgeResults(edge) {
        let keep = [];
        let results = edge.results;
        let sub_curies = edge.subject.curie;
        let obj_curies = edge.object.curie;
        debug(`"${edge.getID()}" R(${edge.reverse}) (${results.length}) results`);
        debug(`"${edge.getID()}" (${sub_curies.length}) sub curies`);
        debug(`"${edge.getID()}" (${obj_curies.length}) obj curies`);

        let objs = edge.reverse ? sub_curies : obj_curies;
        let subs = edge.reverse ? obj_curies : sub_curies;

        results.forEach((res) => {
            //check sub curies against $input ids
            let ids = new Set();
            let outputMatch = false;
            let inputMatch = false;
            res.$input.obj.forEach((o) => {
                for (const prefix in o._dbIDs) {
                    ids.add(prefix + ':' + o._dbIDs[prefix])
                }
                //check ids
                // debug(`CHECKING INPUTS ${JSON.stringify([...ids])}`);
                // debug(`AGAINST ${JSON.stringify(subs)}`);
                inputMatch = _.intersection([...ids], subs).length;
            });
            //check obj curies against $output ids
            let o_ids = new Set();
            res.$output.obj.forEach((o) => {
                for (const prefix in o._dbIDs) {
                    o_ids.add(prefix + ':' + o._dbIDs[prefix])
                }
                //check ids
                // debug(`CHECKING OUTPUTS ${JSON.stringify([...o_ids])}`);
                // debug(`AGAINST ${JSON.stringify(objs)}`);
                outputMatch = _.intersection([...o_ids], objs).length;
            });
            if (inputMatch && outputMatch) {
                keep.push(res);
            }
        });
        debug(`"${edge.getID()}" dropped (${results.length - keep.length}) results.`);
        return keep;
    }

    gatherResults() {
        //go through edges and collect all results
        this.refreshEdges
        debug(`(11) Collecting results...`);
        this.edges.forEach((edge) => {
            let current = this._filterEdgeResults(edge);
            edge.results = current;
            debug(`(11) "${edge.getID()}" keeps (${current.length}) results!`);
            debug(`----------`);
        });
        this.edges.forEach((edge) => {
            edge.results.forEach((r) => {
                this.results.push(r);
            });
        });
        debug(`(12) Collected (${this.results.length}) results!`);
        this.logs.push(
            new LogEntry(
                'DEBUG',
                null,
                `Edge manager collected (${this.results.length}) results!`
            ).getLog(),
        );
    }
};
