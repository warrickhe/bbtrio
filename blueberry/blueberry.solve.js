BLUEBERRY.solve = {};
BLUEBERRY.solve.solve = (desc) => {
    const model = BLUEBERRY.createModel(desc);
    const state = BLUEBERRY.createInitialState(model);
    const r = BLUEBERRY.solve.trySolvePuzzle(model, state, difficulty);
    const check = BLUEBERRY.checkSolved(model, state);
    if (check.status !== "solved") {
        return;
    }
    const s = BLUEBERRY.stringifyState(model, state);
    return s;
};
BLUEBERRY.solve.trySolvePuzzle = (model, state, difficulty) => {
    let solution = [];
    for (;;) {
        const moves = BLUEBERRY.solve.findTechniques(model, state, difficulty);
        if (moves.length === 0) {
            break;
        }
        const move = moves[0];
        solution.push(move);
        BLUEBERRY.solve.applyTechnique(model, state, move);
    }
    return solution;
};
BLUEBERRY.solve.applyTechnique = (model, state, move) => {
    Object.entries(move.knowledge).forEach(([cell, s]) => {
        state.cells[cell] = s;
    });
};
BLUEBERRY.solve.findTechniques = (model, state, difficulty) => {
    console.assert(difficulty === "Standard" || difficulty === "Advanced");
    let moves = [];
    model.allGroups.forEach(group => {
        const standardMoves = BLUEBERRY.solve.tryFillFullTechniques(model, state, group);
        moves = moves.concat(standardMoves);
    });
    if (difficulty === "Advanced") {
        model.allGroups.forEach(group => {
            const advancedMoves = BLUEBERRY.solve.tryMinMaxTechniques(model, state, group);
            moves = moves.concat(advancedMoves);
        });
    }
    moves = moves.concat(BLUEBERRY.solve.tryShallowLookaheadTechnique(model, state));
    if (model.options.pairRuleEnabled) {
        moves = moves.concat(BLUEBERRY.solve.tryPairCommonalityTechnique(model, state));
        moves = moves.concat(BLUEBERRY.solve.tryShallowLookaheadPairsTechnique(model, state));
    }
    model.allGroups.forEach(group => {
        moves = moves.concat(BLUEBERRY.solve.tryCombosTechnique(model, state, group));
    });
    return moves;
};
BLUEBERRY.solve.tryFillFullTechniques = (model, state, group) => {
    const cells = model.cellsOfGroup[group];
    const clue = model.clueFromGroup[group];
    const counts = PUZZLEUTIL.model.countCellsByState(cells, state.cells, ["_","x","o"]);
    if (counts["_"] == 0) {
        return [];
    }
    const moves = [];
    if (counts["o"] == clue) {
        const knowledge = {};
        Object.keys(cells).forEach((cell) => {
            if (state.cells[cell] == "_") {
                knowledge[cell] = "x";
            }
        });
        moves.push({ technique: "FULL", group: group, knowledge, difficulty: 1, usedCluesGroups: [group] });
    }
    if (counts["o"] + counts["_"] == clue) {
        const knowledge = {};
        Object.keys(cells).forEach((cell) => {
            if (state.cells[cell] == "_") {
                knowledge[cell] = "o";
            }
        });
        moves.push({ technique: "FILL", group: group, knowledge: knowledge, difficulty: 1, usedCluesGroups: [group] });
    }
    return moves;
};
BLUEBERRY.solve.tryMinMaxTechniques = (model, state, primaryGroups) => {
    if (!(primaryGroups instanceof Array)) {
        primaryGroups = [primaryGroups];
    }

    const cellsOfAllPrimaryGroups = {};
    { // early exit when all cells in primary groups are already determined
        primaryGroups.forEach(primaryGroup => {
            const cellsOfPrimaryGroup = model.cellsOfGroup[primaryGroup];
            Object.keys(cellsOfPrimaryGroup).forEach(cell => {
                cellsOfAllPrimaryGroups[cell] = true;
            });
        });
        const counts = PUZZLEUTIL.model.countCellsByState(cellsOfAllPrimaryGroups, state.cells, ["_","x","o"]);
        if (counts["_"] === 0) {
            return [];
        }
    }

    const sumPrimaryGroupClues = () => {
        let sum = 0;
        let questionMark = false;
        primaryGroups.forEach((primaryGroup) => {
            const clue = model.clueFromGroup[primaryGroup];
            if (typeof(clue) == "number") {
                sum += clue;
            } else {
                questionMark = true;
            }
        });
        if (questionMark) {
            return undefined;
        }
        return sum;
    };
    const sumOfPrimaryGroupsClues = sumPrimaryGroupClues();
    if (sumOfPrimaryGroupsClues === undefined) {
        return [];
    }

    const nonPrimaryGroups = {};
    {
        const primaryGroupsSet = new Set();
        primaryGroups.forEach(i => {
            primaryGroupsSet.add(i);
        });
        model.allGroups.forEach(group => {
            if (!primaryGroupsSet.has(group)) {
                nonPrimaryGroups[group] = true;
            }
        });
    }

    const moves = [];
    const usedCluesGroups = [];

    const solveWithSubgroupPrefix = (subgroupPrefix) => {
        const subs = {}; // a sub is a non-primary group that the primary group (row or column) intersects
        Object.keys(cellsOfAllPrimaryGroups).forEach(cell => {
            const groups = model.groupsFromCell[cell];
            Object.keys(groups).forEach(group => {
                if (group.startsWith(subgroupPrefix)) {
                    if (nonPrimaryGroups[group]) {
                        if (subs[group] === undefined) {
                            subs[group] = {};
                        }
                    }
                }
            });
        });

        Object.entries(subs).forEach(([subGroup, sub]) => {
            sub.inCounts = { "o": 0, "x": 0, "_": 0 };
            sub.outCounts = { "o": 0, "x": 0, "_": 0 };
            const subCells = model.cellsOfGroup[subGroup]
            const subClue = model.clueFromGroup[subGroup];
            Object.keys(subCells).forEach(cell => {
                if (cellsOfAllPrimaryGroups[cell]) {
                    sub.inCounts[state.cells[cell]] += 1;
                } else {
                    sub.outCounts[state.cells[cell]] += 1;
                }
            });
            if (typeof(subClue) === "number") {
                sub.minDots = Math.max(
                    sub.inCounts["o"],
                    subClue - (sub.outCounts["o"] + sub.outCounts["_"]),
                );
                sub.maxDots = Math.min(
                    subClue,
                    sub.inCounts["o"] + Math.min(
                                            sub.inCounts["_"],
                                            (subClue - sub.inCounts["o"] - sub.outCounts["o"])
                                        )
                    );
            } else {
                sub.minDots = sub.inCounts["o"];
                sub.maxDots = sub.inCounts["o"] + sub.inCounts["_"];
            }
        });

        let minDotsSum = 0;
        let maxDotsSum = 0;
        Object.entries(subs).forEach(([subGroup, sub]) => {
            minDotsSum += sub.minDots;
            maxDotsSum += sub.maxDots;
        });

        if (maxDotsSum === sumOfPrimaryGroupsClues) {
            // MAX
            const knowledge = {};
            Object.entries(subs).forEach(([subGroup, sub]) => {
                const subCells = model.cellsOfGroup[subGroup]
                const subClue = model.clueFromGroup[subGroup];
                if (sub.inCounts["_"] + sub.inCounts["o"] == sub.maxDots) {
                    // -> inside is full

                    // fill inside blanks with dots
                    Object.keys(subCells).forEach((cell) => {
                        if (cellsOfAllPrimaryGroups[cell]) { // is cell inside?
                            if (state.cells[cell] == "_") {
                                knowledge[cell] = "o";
                            }
                        }
                    });
                }
                if (typeof(subClue) === "number") {
                    const numDotsToPlaceOutside = subClue - sub.maxDots - sub.outCounts["o"];
                    if (numDotsToPlaceOutside == 0) {
                        // fill outside blanks with crosses
                        Object.keys(subCells).forEach((cell) => {
                            if (cellsOfAllPrimaryGroups[cell] === undefined) { // is cell outside?
                                if (state.cells[cell] == "_") {
                                    knowledge[cell] = "x";
                                }
                            }
                        });
                    }
                }
            });
            if (Object.keys(knowledge).length > 0) {
                const difficulty = primaryGroups.length > 1 ? 3 : 2;
                moves.push({technique: `MAX`, primaryGroups: primaryGroups, subs: subs, knowledge: knowledge, difficulty, usedCluesGroups});
            }
        } else if (minDotsSum === sumOfPrimaryGroupsClues) {
            // MIN
            const knowledge = {};
            Object.entries(subs).forEach(([subGroup, sub]) => {
                const subClue = model.clueFromGroup[subGroup];
                const subCells = model.cellsOfGroup[subGroup]
                if (sub.minDots == 0) {
                    // fill inside blanks with crosses
                    Object.keys(subCells).forEach((cell) => {
                        if (cellsOfAllPrimaryGroups[cell]) { // is cell inside?
                            if (state.cells[cell] == "_") {
                                knowledge[cell] = "x";
                            }
                        }
                    });
                }

                if (sub.inCounts["_"] + sub.inCounts["o"] == sub.minDots) {
                    // -> inside is full

                    // fill inside blanks with dots
                    Object.keys(sub).forEach((cell) => {
                        if (cellsOfAllPrimaryGroups[cell]) { // is cell inside?
                            if (state.cells[cell] == "_") {
                                knowledge[cell] = "o";
                            }
                        }
                    });
                }
                if (typeof(subClue) == "number") {
                    const numDotsToPlaceOutside = subClue - sub.minDots - sub.outCounts["o"];
                    if (numDotsToPlaceOutside == 0) {
                        // fill outside blanks with crosses
                        Object.keys(subCells).forEach((cell) => {
                            if (cellsOfAllPrimaryGroups[cell] === undefined) { // is cell outside?
                                if (state.cells[cell] == "_") {
                                    knowledge[cell] = "x";
                                }
                            }
                        });
                    }
                    if (numDotsToPlaceOutside == sub.outCounts["_"]) {
                        // fill outside blanks with dots
                        Object.keys(subCells).forEach((cell) => {
                            if (cellsOfAllPrimaryGroups[cell] === undefined) { // is cell outside?
                                if (state.cells[cell] == "_") {
                                    knowledge[cell] = "o";
                                }
                            }
                        });
                    }
                }
            });
            if (Object.entries(knowledge).length > 0) {
                const difficulty = primaryGroups.length > 1 ? 3 : 2;
                moves.push({technique: `MIN`, primaryGroups: primaryGroups, subs: subs, knowledge: knowledge, difficulty, usedCluesGroups});
            }
        }
    };
    ["R","C","B"].forEach(prefix => {
        solveWithSubgroupPrefix(prefix);
    });
    return moves;
};
BLUEBERRY.solve.tryShallowLookaheadTechnique = (model, state) => {
    const possibleStates = ["x", "o"];
    const knowledge = {};
    Object.keys(model.grid.cells).filter(cell => state.cells[cell] === "_").forEach(cell => {
        const worked = [];
        possibleStates.forEach(p => {
            state.cells[cell] = p;
            const check = BLUEBERRY.checkSolved(model, state);
            if (check.status !== "error") {
                worked.push(p);
            }
            state.cells[cell] = "_";
        });
        if (worked.length === 1) {
            knowledge[cell] = worked[0];
        }
    });
    const moves = [];
    if (Object.keys(knowledge).length > 0) {
        const move = {technique: "SHALLOW-LOOKAHEAD", knowledge};
        moves.push(move);
    }
    return moves;
};
BLUEBERRY.solve.tryShallowLookaheadPairsTechnique = (model, state) => {
    const knowledge = {};
    Object.keys(model.grid.cells).filter(cell => state.cells[cell] === "_").forEach(cell => {
        state.cells[cell] = "o";
        const allNeighbors = model.grid.orthogonalNeighborsOfCell[cell];
        const neighborsByState = PUZZLEUTIL.model.splitCellsByState(allNeighbors, state.cells, ["_","x","o"]);
        const openNeighbors = neighborsByState["_"];
        const berryNeighbors = neighborsByState["o"];
        if (Object.keys(berryNeighbors).length === 0) {
            const worked = [];
            Object.keys(openNeighbors).forEach(ncell => {
                state.cells[ncell] = "o";
                const check = BLUEBERRY.checkSolved(model, state);
                if (check.status !== "error") {
                    worked.push(ncell);
                }
                state.cells[ncell] = "_";
            });
            if (worked.length === 0) {
                knowledge[cell] = "x";
            }
        }
        state.cells[cell] = "_";
    });
    const moves = [];
    if (Object.keys(knowledge).length > 0) {
        const move = {technique: "SHALLOW-LOOKAHEAD-PAIRS", knowledge};
        moves.push(move);
    }
    return moves;
};
BLUEBERRY.solve.tryPairCommonalityTechnique = (model, state) => {
    const moves = [];
    Object.keys(model.grid.cells).filter(cell => state.cells[cell] === "o").forEach(cell => {
        const allNeighbors = model.grid.orthogonalNeighborsOfCell[cell];
        const neighborsByState = PUZZLEUTIL.model.splitCellsByState(allNeighbors, state.cells, ["_","x","o"]);
        const openNeighbors = neighborsByState["_"];
        const openNeighborsK = Object.keys(openNeighbors);
        const berryNeighbors = neighborsByState["o"];
        if (Object.keys(berryNeighbors).length === 0) {
            if (openNeighborsK.length === 2) {
                const neighbor1 = openNeighborsK[0];
                const neighbor2 = openNeighborsK[1];
                const common = Object.keys(intersectSetsO(
                    model.grid.orthogonalNeighborsOfCell[neighbor1],
                    model.grid.orthogonalNeighborsOfCell[neighbor2]
                )).filter(i => state.cells[i] === "_");
                console.assert(common.length === 0 || common.length === 1);
                if (common.length === 1) {
                    const move = {technique: "PAIR-COMMONALITY", knowledge: {[common[0]]: "x"}, cherryCell: cell};
                    moves.push(move);
                }
            }
        }
    });
    return moves;
};
BLUEBERRY.solve.tryCombosTechnique = (model, state, group) => {
    const cells = model.cellsOfGroup[group];
    const clue = model.clueFromGroup[group];
    if (typeof(clue) !== "number") { return []; }
    const cellsFromState = PUZZLEUTIL.model.splitCellsByState(cells, state.cells, ["_", "x", "o"]);
    const undecidedCells = cellsFromState["_"];
    const alreadyBerryCells = cellsFromState["o"];
    const numBerriesNeeded = clue - Object.keys(alreadyBerryCells).length;
    if (numBerriesNeeded === 0) { return []; }
    const numUndecidedCells = Object.keys(undecidedCells).length;
    const maxCombinations = 16;
    const numCombos = numCombinations(numUndecidedCells, numBerriesNeeded);
    if (numCombos > maxCombinations) {
        return [];
    }
    const combos = combinations(Object.keys(undecidedCells), numBerriesNeeded);
    if (combos.length === 0) { return []; }
    const numOkCombosFromCell = {};
    const numErrorCombosFromCell = {};
    let numOkCombos = 0;
    let numErrorCombos = 0;
    Object.keys(cells).forEach(cell => {
        numOkCombosFromCell[cell] = 0;
        numErrorCombosFromCell[cell] = 0;
    });
    combos.filter(combo => {
        combo.forEach(cell => { state.cells[cell] = "o"; });
        const check = BLUEBERRY.checkSolved(model, state);
        combo.forEach(cell => { state.cells[cell] = "_"; });
        const isError = check.status === "error";
        const isOk = !isError;
        if (isOk) { numOkCombos += 1; }
        if (isError) { numErrorCombos += 1; }
        combo.forEach(cell => {
            if (isOk) { numOkCombosFromCell[cell] += 1; }
            if (isError) { numErrorCombosFromCell[cell] += 1; }
        });
    });
    const knowledge = {};
    Object.keys(undecidedCells).forEach(cell => {
        const numOk = numOkCombosFromCell[cell];
        const numError = numErrorCombosFromCell[cell];
        if (numOk === numOkCombos) {
            knowledge[cell] = "o";
        } else if (numOk === 0 && numError > 0) {
            knowledge[cell] = "x";
        }
    });
    // TODO:jkd do not use object.keys to determine of an object is empty!!! it's slow. 
    // fix this across the whole codebase.
    // https://stackoverflow.com/questions/679915/how-do-i-test-for-an-empty-javascript-object
    if (Object.keys(knowledge).length === 0) { return []; }
    let clueCell;
    if (group.startsWith("N-")) { clueCell = group.slice(2); }
    const move = { technique: "COMBOS", knowledge, group, numOkCombos, clueCell };
    return [move];
};