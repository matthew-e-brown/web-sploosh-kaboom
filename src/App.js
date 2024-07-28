import React from 'react';
import './App.css';
import Collapsible from 'react-collapsible';
import init, {
    set_board_table,
    calculate_probabilities_without_sequence,
    calculate_probabilities_from_game_history,
    disambiguate_board,
} from './wasm/sploosh_wasm.js';
import { dbRead, dbWrite } from './database';
import interpolate from 'color-interpolate';

const VERSION_STRING = 'v0.0.22';

// .        . . . .
// 0123456789abcdef
const colormap = interpolate(['#004', '#070', '#090', '#0b0', '#0d0', '#0f0', '#6f6']);
const naturalsUpTo = (n) => [...Array(n).keys()];

class Tile extends React.Component {
    render() {
        const isBest = this.props.best !== null && this.props.best[0] === this.props.x && this.props.best[1] === this.props.y;
        let className = 'boardTile' + (this.props.valid ? '' : ' invalid')
            + (isBest ? ' selected' : '');

        let backgroundColor = this.props.backgroundColor;
        if (backgroundColor === undefined) {
            backgroundColor = this.props.text === null ? colormap(this.props.prob) : (
                this.props.text === 'HIT' ? '#a2a' : '#44a'
            );
        }

        return <div className={ className }
            key={this.props.x + ',' + this.props.y}
            style={{
                fontSize: this.props.fontSize,
                opacity: this.props.opacity,
                backgroundColor,
            }}
            onClick={this.props.onClick}
        >
            {this.props.text === null ? (this.props.prob * 100).toFixed(this.props.precision) + '%' : this.props.text}
        </div>;
    }
}

let wasm = init(process.env.PUBLIC_URL + "/sploosh_wasm_bg.wasm");

// Super ugly, please forgive me. :(
var globalMap = null;

async function dbCachedFetch(url, callback) {
    function cacheMiss() {
        const req = new XMLHttpRequest();
        req.open('GET', process.env.PUBLIC_URL + url, true);
        req.responseType = 'arraybuffer';
        req.onload = (evt) => {
            dbWrite(url, req.response);
            callback(req.response);
        };
        req.send();
        return null;
    }
    const result = await dbRead(url).catch(cacheMiss);
    if (result === undefined) {
        cacheMiss();
        return;
    }
    // This is sort of an ugly protocol, but if we hit the catch path above
    // we signal that the callback was already called by returning null.
    if (result === null)
        return;
    callback(result);
}

async function makeBoardIndicesTable() {
    function cacheMiss() {
        const result = actuallyMakeBoardIndicesTable();
        dbWrite('boardIndicesTable', result);
        return result;
    }
    const result = await dbRead('boardIndicesTable').catch(cacheMiss);
    if (result === undefined)
        return cacheMiss();
    return result;
}

function actuallyMakeBoardIndicesTable() {
    // This convention here has to match that in the Rust component and table building C++ exactly!
    const descs = [];
    for (let y = 0; y < 8; y++)
        for (let x = 0; x < 8; x++)
            for (const direction of [false, true])
                descs.push({x, y, direction});
    const allBoards = [];
    const boardIndices = {};
    function placeSquid(board, desc, length) {
        for (let i = 0; i < length; i++) {
            let {x, y} = desc;
            if (desc.direction)
                x += i;
            else
                y += i;
            const index = x + 8 * y;
            if (x >= 8 || y >= 8)
                return;
            board[index] = length;
        }
    }
    const board = new Array(64).fill(0);

    for (const squid2 of descs) {
        for (const squid3 of descs) {
            for (const squid4 of descs) {
                board.fill(0);
                placeSquid(board, squid2, 2);
                placeSquid(board, squid3, 3);
                placeSquid(board, squid4, 4);
                let count = 0;
                for (const entry of board)
                    count += entry
                if (count !== 2*2 + 3*3 + 4*4)
                    continue;
                allBoards.push(Array.from(board));
            }
        }
    }
    let index = 0;
    for (const board of allBoards) {
        boardIndices[board.map((i) => i === 0 ? '.' : i).join('')] = index;
        index++;
    }
    return boardIndices;
}

function generateRandomChar() {
    const base58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
    const array = new Uint8Array(1);
    while (true) {
        crypto.getRandomValues(array);
        const index = array[0] & 63;
        if (index < base58.length)
            return base58[index];
    }
}

function generateRandomToken(n) {
    let result = '';
    for (let i = 0; i < n; i++)
        result += generateRandomChar();
    return result;
}

// Ugh, maybe later I'll give it a proper domain, and move over to https.
const SPYWARE_HOST = 'http://skphonehome.peter.website:1234';

var globalSpyware = null;
var globalSpywareCounter = -1;

// To anyone reading this:
// I chose the name "spyware" to be silly — this is a completely optional opt-in feature to send usage data for analysis.
// You have to actually explicitly enable the spyware with a checkbox in the GUI, and there's an explanation.
async function sendSpywareEvent(eventData) {
    if (globalSpyware === null || globalMap === null)
        return;
    if (!globalSpyware.state.loggedIn)
        return;
    if (!globalMap.state.spywareMode)
        return;
    eventData.timestamp = (new Date()).getTime() / 1000;
    globalSpywareCounter++;
    const body = JSON.stringify({
        username: globalSpyware.state.username,
        token: globalSpyware.state.token,
        session: globalSpyware.session,
        events: {
            [globalSpywareCounter]: eventData,
        },
    });
    const response = await fetch(SPYWARE_HOST + '/write', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body,
    });
    globalSpyware.setState({charsSent: globalSpyware.state.charsSent + body.length});
    if (!response.ok)
        globalSpyware.setState({errors: true});
}

class SpywareModeConfiguration extends React.Component {
    constructor() {
        super();
        globalSpyware = this;
        this.session = generateRandomToken(16);
        let token = localStorage.getItem('SKToken');
        if (token === null) {
            token = generateRandomToken(8);
            localStorage.setItem('SKToken', token);
        }
        let defaultUsername = localStorage.getItem('SKUsername');
        this.state = {
            username: defaultUsername === null ? '' : defaultUsername,
            token,
            loggedIn: false,
            errors: false,
            charsSent: false,
        };
    }

    async onLogin() {
        const username = this.state.username;
        if (username === '') {
            alert('Username must be non-empty');
            return;
        }
        const response = await fetch(SPYWARE_HOST + '/login', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                'username': username,
                'token': this.state.token,
            }),
        });
        const result = await response.json();
        console.log('Login:', result);
        if (result.success) {
            // Stash the username when we successfully log in, as a convenience for the user.
            localStorage.setItem('SKUsername', username);
            this.setState({loggedIn: true}, () => {
                sendSpywareEvent({
                    kind: 'login',
                    version: VERSION_STRING,
                    bigTable: globalMap === null ? null : globalMap.bigTable,
                });
            });
        } else {
            alert('Bad token! This username might already be taken. If you need to recover your login token contact Peter Schmidt-Nielsen.');
        }
    }

    async onLogout() {
        this.setState({loggedIn: false});
    }

    render() {
        return <div id='spywareConfig' className={this.state.loggedIn ? 'logged-in' : undefined}>
            <span style={{fontSize: '120%'}}>Spyware Mode:</span>
            <br/>
            {
                this.state.loggedIn ?
                    <>
                        Logged in as: <span style={{fontFamily: 'monospace', fontSize: '150%'}}>{this.state.username}</span>
                        <button style={{marginLeft: '20px'}} onClick={() => this.onLogout()}>Logout</button>
                        <br/>
                        Events sent: {globalSpywareCounter + 1} &nbsp;&nbsp;&nbsp; Chars sent: {this.state.charsSent}
                    </> : <>
                        Username: <input data-stop-shortcuts style={{width: '100px', fontFamily: 'monospace'}} value={this.state.username} onChange={event => this.setState({username: event.target.value})}/>
                        <button style={{marginLeft: '20px'}} onClick={() => this.onLogin()}>Login</button>
                    </>
            }
            <br/>
            <div style={{marginTop: '20px'}}>
                <Collapsible trigger={
                    <div className="clickable" style={{width: '200px', margin: '0px'}}>
                        Access Token
                    </div>
                }>
                    Token: <input data-stop-shortcuts style={{width: '120px', marginRight: '20px'}} value={this.state.token} onChange={event => this.setState({token: event.target.value})}/>
                    <button onClick={() => { localStorage.setItem('SKToken', this.state.token); }}>Update Saved Token</button>
                    <p>
                        The above token is generated just for you.
                        Anyone who has the above token can submit data that will appear on the stats page for your username (so I recommend not showing it on stream).
                        If you lose access to it you'll have to pick a new username, or ask <a href="mailto:schmidtnielsenpeter@gmail.com">Peter Schmidt-Nielsen</a> to help you recover your access token.
                        The token is automatically saved between sessions, but might be lost if you clear all your browser history.
                        I recommend copying this token down somewhere.
                    </p>
                </Collapsible>
            </div>
            {this.state.errors && <span style={{fontSize: '120%', color: 'red'}}>Spyware reporting error!</span>}
        </div>;
    }
}

function sampleSquid(length) {
    const x = Math.round(Math.random() * 8);
    const y = Math.round(Math.random() * 8);
    const direction = Math.random() < 0.5;
    const cells = [[x, y]];
    for (let i = 0; i < length - 1; i++) {
        const cell = cells[cells.length - 1];
        const newXY = direction ? [cell[0] + 1, cell[1]] : [cell[0], cell[1] + 1];
        cells.push(newXY);
    }
    return cells;
}

function generateLayout() {
    const layout = {};
    const hitLocations = {};
    for (const n of [2, 3, 4]) {
        while (true) {
            const candidate = sampleSquid(n);
            let isAdmissible = true;
            for (const cell of candidate)
                if (cell[0] > 7 || cell[1] > 7 || hitLocations[cell] === true)
                    isAdmissible = false;
            if (isAdmissible) {
                layout['squid' + n] = candidate;
                for (const cell of candidate)
                    hitLocations[cell] = true;
                break;
            }
        }
    }
    return layout;
}

class LayoutDrawingBoard extends React.Component {
    constructor() {
        super();
        this.state = { grid: this.makeEmptyGrid(), selectedCell: null };
    }

    makeEmptyGrid() {
        const grid = [];
        for (let y = 0; y < 8; y++)
            for (let x = 0; x < 8; x++)
                grid[[x, y]] = '.';
        return grid;
    }

    clearBoard() {
        this.setState({ grid: this.makeEmptyGrid(), selectedCell: null });
    }

    onClick(x, y) {
        if (this.state.selectedCell === null) {
            this.setState({ selectedCell: [x, y] });
            return;
        }
        const grid = {...this.state.grid};
        let changeMade = false;
        for (const length of [2, 3, 4]) {
            for (const [dx, dy] of [[+1, 0], [0, +1], [-1, 0], [0, -1]]) {
                if (this.state.selectedCell[0] === x + dx * (length - 1) && this.state.selectedCell[1] === y + dy * (length - 1)) {
                    // If this squid appears anywhere else, obliterate it.
                    for (let y = 0; y < 8; y++)
                        for (let x = 0; x < 8; x++)
                            if (grid[[x, y]] === '' + length)
                                grid[[x, y]] = '.';
                    // Fill in the squid here.
                    for (let i = 0; i < length; i++)
                        grid[[x + i * dx, y + i * dy]] = '' + length;
                    changeMade = true;
                }
            }
        }
        // If any squid has the wrong count, then totally eliminate it.
        const countsBySquid = {2: 0, 3: 0, 4: 0, '.': 0};
        for (let y = 0; y < 8; y++)
            for (let x = 0; x < 8; x++)
                countsBySquid[grid[[x, y]]]++;
        for (const length of [2, 3, 4])
            if (countsBySquid[length] !== length)
                for (let y = 0; y < 8; y++)
                    for (let x = 0; x < 8; x++)
                        if (grid[[x, y]] === '' + length)
                            grid[[x, y]] = '.';
        if (changeMade)
            this.setState({ grid });
        this.setState({ selectedCell: null });
    }

    getLayoutString() {
        // Quadratic time, but who cares?
        let layoutString = '';
        for (let y = 0; y < 8; y++)
            for (let x = 0; x < 8; x++)
                layoutString += this.state.grid[[x, y]];
        return layoutString;
    }

    setStateFromLayoutString(layoutString) {
        const grid = [];
        for (let y = 0; y < 8; y++)
            for (let x = 0; x < 8; x++)
                grid[[x, y]] = layoutString[x + 8 * y];
        this.setState({grid});
    }

    render() {
        const layoutString = this.getLayoutString();
        let boardIndex = this.props.parent.boardIndices[layoutString];
        if (boardIndex === undefined) {
            boardIndex = "waiting...";
        }
        const isSelectedCell = (x, y) => this.state.selectedCell !== null && x === this.state.selectedCell[0] && y === this.state.selectedCell[1];

        return <div className='historyBoardContainer'>
            <div className='historyBoard'>
                {naturalsUpTo(8).map(
                    (y) => <div key={y} style={{
                        display: 'flex',
                    }}>
                        {naturalsUpTo(8).map(
                            (x) => <Tile
                                key={x + ',' + y}
                                x={x} y={y}
                                onClick={() => this.onClick(x, y)}
                                text={this.state.grid[[x, y]]}
                                valid={true}
                                best={this.state.selectedCell}
                                fontSize={'200%'}
                                opacity={isSelectedCell(x, y) || this.state.grid[[x, y]] !== '.' ? 0.6 : 0.2}
                                backgroundColor={this.state.grid[[x, y]] === '.' ? undefined : 'green'}
                            />
                        )}
                    </div>
                )}
            </div><br/>
            Squid Layout: {boardIndex}
        </div>;
    }
}

function renderYesNo(bool) {
    return bool ?
        <span style={{color: 'green', textShadow: '0px 0px 2px white'}}>YES</span> :
        <span style={{color: 'red', textShadow: '0px 0px 2px white'}}>NO</span>;
}

class BoardTimer extends React.Component {
    constructor() {
        super();
        this.state = {
            timerStartMS: 0.0,
            timerRunning: false,
            includesLoadingTheRoom: true,
            includedRewardsGotten: 0,
            invalidated: false,
        };
        this.shortcutsHandler = this.shortcutsHandler.bind(this);
    }

    componentDidMount() {
        document.addEventListener('keydown', this.shortcutsHandler);
        this.timerID = setInterval(() => this.forceUpdate(), 66);
    }

    componentWillUnmount() {
        document.removeEventListener('keydown', this.shortcutsHandler);
        clearInterval(this.timerID);
    }

    startRunning() {
        const timerStartMS = performance.now();
        sendSpywareEvent({kind: 'timer_startRunning', oldState: this.state});
        this.setState({timerRunning: true, timerStartMS});
    }

    adjustRewards(delta) {
        sendSpywareEvent({kind: 'timer_adjustRewards', delta, oldState: this.state});
        this.setState({includedRewardsGotten: Math.max(0, Math.min(2, this.state.includedRewardsGotten + delta))});
    }

    toggleInvalidated() {
        sendSpywareEvent({kind: 'timer_toggleInvalidated', oldState: this.state});
        this.setState({invalidated: !this.state.invalidated});
    }

    resetTimer() {
        sendSpywareEvent({kind: 'timer_resetTimer', oldState: this.state});
        this.setState({
            timerRunning: false,
            includesLoadingTheRoom: true,
            includedRewardsGotten: 0,
            invalidated: false,
        });
        globalMap.setState({ timerStepEstimate: null });
    }

    getSecondsElapsed() {
        if (this.state.timerRunning) {
            const now = performance.now();
            return 1e-3 * (now - this.state.timerStartMS);
        }
        return 0;
    }

    guessStepsElapsedFromTime(timeDeltaSeconds) {
        // I did some linear regressions from real HD Italian runs. I'll put some data up at some point.
        let prediction = Number(this.props.timedTickIntercept) + Number(this.props.timedTickRate) * timeDeltaSeconds;
        if (this.state.includesLoadingTheRoom)
            prediction += -940 + Number(this.props.roomEnteredOffset);
        prediction += this.state.includedRewardsGotten * 760;
        return Math.round(prediction);
    }

    shortcutsHandler(evt) {
        // Check if the target is an input field that should take precedence over shortcuts.
        if (evt.target?.getAttribute?.('data-stop-shortcuts'))
            return;

        if (evt.ctrlKey || evt.altKey)
            return;

        if (evt.code === 'Comma')
            if (evt.shiftKey)
                this.adjustRewards(-1);
            else
                this.adjustRewards(+1);
        if (evt.code === 'Semicolon')
            if (evt.shiftKey)
                this.resetTimer();
            else
                this.toggleInvalidated();
    }

    render() {
        const elapsed = this.getSecondsElapsed();
        if (this.state.invalidated)
            return <>
                <span style={{ fontSize: '150%', fontFamily: 'monospace' }}>TIMER</span>
                <span style={{ fontSize: '150%', fontFamily: 'monospace' }}>INVALIDATED</span>
            </>;
        return <>
            <span>&nbsp;Seconds elapsed: </span>
            <span>&nbsp;{elapsed.toFixed(2)}&nbsp;</span>
            <span>&nbsp;Steps:&nbsp;</span>
            <span>&nbsp;{this.guessStepsElapsedFromTime(elapsed)}&nbsp;</span>
            <span>&nbsp;Entered room:</span>
            <span>&nbsp;{renderYesNo(this.state.includesLoadingTheRoom)}&nbsp;</span>
            <span>&nbsp;Rewards gotten:&nbsp;</span>
            <span>&nbsp;{this.state.includedRewardsGotten}&nbsp;</span>
        </>;
    }
}

function computeL1Distance(p1, p2) {
    return Math.abs(p1[0] - p2[0]) + Math.abs(p1[1] - p2[1]);
}

const defaultConfigurationParams = {
    firstBoardStepsThousands: 500,
    firstBoardStepsThousandsStdDev: 500,
    nextBoardStepsThousands: 7,
    nextBoardStepsThousandsStdDev: 3,
    timedBoardStepsThousandsStdDev: 0.2,
    timedTickIntercept: 156,
    timedTickRate: 252,
    roomEnteredOffset: 0,
};

class MainMap extends React.Component {
    layoutDrawingBoardRefs = [React.createRef(), React.createRef(), React.createRef()];
    timerRef = React.createRef();

    constructor() {
        super();
        this.state = this.makeEmptyState();
        globalMap = this;
        this.shortcutsHandler = this.shortcutsHandler.bind(this);
    }

    componentDidMount() {
        document.addEventListener('keydown', this.shortcutsHandler);
        this.doComputation(this.state.grid, this.state.squidsGotten);
    }

    componentWillUnmount() {
        document.removeEventListener('keydown', this.shortcutsHandler);
    }

    makeEmptyGrid() {
        const grid = [];
        for (let y = 0; y < 8; y++)
            for (let x = 0; x < 8; x++)
                grid[[x, y]] = null;
        return grid;
    }

    makeEmptyState() {
        const probs = [];
        for (let y = 0; y < 8; y++)
            for (let x = 0; x < 8; x++)
                probs[[x, y]] = 0.0;
        // Select a particular layout, for practice mode.
        const squidLayout = generateLayout();
        const state = {
            mode: 'calculator',
            squidLayout,
            grid: this.makeEmptyGrid(),
            squidsGotten: 'unknown',
            undoBuffer: [],
            probs,
            best: [3, 4],
            cursorBelief: [0, 7],
            valid: true,
            observationProb: 1.0,
            lastComputationTime: -1,

            sequenceAware: false,
            usingTimer: true,
            showKeyShortcuts: false,
            spywareMode: false,

            timerStepEstimate: null,

            potentialMatches: null,
        };
        // Load relevant configuration from localStorage.
        let savedSettings = localStorage.getItem('SKSettings');
        if (savedSettings === null) {
            savedSettings = defaultConfigurationParams;
        } else {
            // if saved configuration from previous version, use defaults for
            // any new parameters
            savedSettings = JSON.parse(savedSettings);
            for (const name of Object.keys(defaultConfigurationParams)) {
                if (!(name in savedSettings)){
                    savedSettings[name] = defaultConfigurationParams[name];
                }
            }
        }
        const configParams = savedSettings;
        return {...state, ...configParams};
    }

    getConfigParams() {
        const settings = {};
        for (const name of Object.keys(defaultConfigurationParams))
            settings[name] = Number(this.state[name]);
        return settings;
    }

    saveConfigParams() {
        const configParams = this.getConfigParams();
        console.log('Saving config params:', configParams);
        localStorage.setItem('SKSettings', JSON.stringify(configParams));
    }

    factoryResetConfigParams() {
        this.setState(defaultConfigurationParams);
    }

    async loadSequenceTable(bigTable) {
        if (this.state.sequenceAware !== false)
            return;
        this.bigTable = bigTable;
        this.setState({ sequenceAware: 'initializing' });
        this.boardIndices = await makeBoardIndicesTable();
        this.boardIndexToLayoutString = new Array(Object.keys(this.boardIndices).length);
        for (const key of Object.keys(this.boardIndices))
            this.boardIndexToLayoutString[this.boardIndices[key]] = key;

        const tableName = bigTable ? '/board_table_25M.bin' : '/board_table_5M.bin';
        dbCachedFetch(tableName, (buf) => {
            this.boardTable = new Uint32Array(buf);
            // Warning: Do I need to await wasm here first?
            console.log('Board table length:', this.boardTable.length);
            set_board_table(this.boardTable);
            this.setState({ sequenceAware: true, mode: 'calculator' },
                () => { this.clearField(); }
            );
        });
    }

    *findMatchingLocations(observedBoards, startIndex, scanRange) {
        // Try to find matches for the next board.
        const soughtBoard = observedBoards[0];
        const remainingBoards = observedBoards.slice(1);
        const boardTable = this.boardTable;
        const indexMax = Math.min(boardTable.length, startIndex + scanRange);
        for (let i = startIndex; i < indexMax; i++)
            if (boardTable[i] === soughtBoard)
                if (remainingBoards.length > 0)
                    for (const subResult of this.findMatchingLocations(remainingBoards, i, 100000))
                        yield [i, ...subResult];
                else
                    yield [i];
    }

    recomputePotentialMatches() {
        const observedBoards = this.makeGameHistoryArguments()[0];
        const matches = [];
        if (observedBoards.length > 0)
            for (const match of this.findMatchingLocations(observedBoards, 0, 1000000000))
                matches.push(match);
        sendSpywareEvent({kind: 'recomputePotentialMatches', matches});
        this.setState({potentialMatches: matches});
    }

    makeGameHistoryArguments() {
        // Figure out how many history boards we have.
        const rawObservedBoards = this.layoutDrawingBoardRefs
            .map((ref) => this.boardIndices[ref.current.getLayoutString()]);
        const observedBoards = [];
        for (const ob of rawObservedBoards) {
            if (ob === undefined)
                break;
            observedBoards.push(ob);
        }

        // The optimal thing to do here is to save the sequence of step delta estimates, but to make
        // the tool less fragile we only use our timer-based estimates for the very final mean.

        const priorStepsFromPreviousMeans = [];
        const priorStepsFromPreviousStdDevs = [];
        let first = true;
        for (const index of [...observedBoards, null]) {
            if (index === undefined)
                break;
            if (first) {
                priorStepsFromPreviousMeans.push(1000.0 * Number(this.state.firstBoardStepsThousands));
                priorStepsFromPreviousStdDevs.push(1000.0 * Number(this.state.firstBoardStepsThousandsStdDev));
            } else {
                // If we're the last delta, and also not the first, then possibly use our time delta.
                if (index === null && this.state.timerStepEstimate !== null && this.state.usingTimer) {
                    // Because the timerStepEstimate can be negative I have to avoid underflow.
                    priorStepsFromPreviousMeans.push(Math.max(0, this.state.timerStepEstimate));
                    priorStepsFromPreviousStdDevs.push(1000.0 * Number(this.state.timedBoardStepsThousandsStdDev));
                } else {
                    priorStepsFromPreviousMeans.push(1000.0 * Number(this.state.nextBoardStepsThousands));
                    priorStepsFromPreviousStdDevs.push(1000.0 * Number(this.state.nextBoardStepsThousandsStdDev));
                }
            }
            first = false;
        }
        return [
            Uint32Array.from(observedBoards),
            Uint32Array.from(priorStepsFromPreviousMeans),
            Float64Array.from(priorStepsFromPreviousStdDevs),
        ];
    }

    getGridStatistics(grid, squidsGotten) {
        const hits = [];
        const misses = [];
        for (let y = 0; y < 8; y++) {
            for (let x = 0; x < 8; x++) {
                const gridValue = grid[[x, y]];
                if (gridValue === 'HIT')
                    hits.push(8 * y + x);
                if (gridValue === 'MISS')
                    misses.push(8 * y + x);
            }
        }
        let numericSquidsGotten = -1;
        for (const n of ['0', '1', '2', '3'])
            if (squidsGotten === n || squidsGotten === Number(n))
                numericSquidsGotten = Number(n);
        return {hits, misses, numericSquidsGotten};
    }

    async doComputation(grid, squidsGotten) {
        console.log('Doing computation:', squidsGotten, grid);
        const t0 = performance.now();
        const {hits, misses, numericSquidsGotten} = this.getGridStatistics(grid, squidsGotten);

        await wasm;
        let probabilities;
        let gameHistoryArguments = null;
        if (this.state.sequenceAware === true) {
            gameHistoryArguments = this.makeGameHistoryArguments();
            console.log('gameHistoryArguments:', gameHistoryArguments);

            probabilities = calculate_probabilities_from_game_history(
                Uint8Array.from(hits),
                Uint8Array.from(misses),
                numericSquidsGotten,
                ...gameHistoryArguments,
            );
        } else {
            probabilities = calculate_probabilities_without_sequence(
                Uint8Array.from(hits),
                Uint8Array.from(misses),
                numericSquidsGotten,
            );
        }

        let valid = true;
        if (probabilities !== undefined) {
            let maxY = 0;
            let maxX = 0;
            let highestProb = -1;
            let probs = [];

            // Here we implement our L1 distance bonus heuristic.
            // The idea is that we want to highlight a square that isn't too far from where
            // the player last adjusted the board. (i.e. where we believe their cursor is.)
            for (let y = 0; y < 8; y++) {
                for (let x = 0; x < 8; x++) {
                    probs[[x, y]] = probabilities[8 * y + x];
                    const l1Distance = computeL1Distance(this.state.cursorBelief, [x, y]);
                    const distancePenaltyMultiplier = 1 - 0.03 * l1Distance;
                    const distanceAdjustedProb = probabilities[8 * y + x] * distancePenaltyMultiplier;
                    if (grid[[x, y]] === null && distanceAdjustedProb > highestProb) {
                        highestProb = distanceAdjustedProb;
                        maxX = x;
                        maxY = y;
                    }
                }
            }
            const observationProb = probabilities[64];
            this.setState({ probs, best: highestProb > 0 ? [maxX, maxY] : null, valid, observationProb });
        } else {
            valid = false;
            this.setState({ valid, best: null });
        }
        const t1 = performance.now();
        this.setState({lastComputationTime: t1 - t0});
        // Send a really big payload.
        sendSpywareEvent({
            kind: 'doComputation',
            grid, hits, misses, numericSquidsGotten,
            oldValid: this.state.valid,
            didWeConcludeTheSituationWasValid: valid,
            probabilities: Array.from(probabilities ?? []),
            sequenceAware: this.state.sequenceAware,
            usingTimer: this.state.usingTimer,
            gameHistoryArguments: (gameHistoryArguments === null) ? [] : gameHistoryArguments.map(a => Array.from(a)),
            timerStepEstimate: this.state.timerStepEstimate,
            computationTime: (t1 - t0) / 1000,
            configParams: this.getConfigParams(),
        });
    }

    copyToUndoBuffer() {
        this.setState({undoBuffer: [
            ...this.state.undoBuffer,
            {grid: this.state.grid, squidsGotten: this.state.squidsGotten, cursorBelief: this.state.cursorBelief},
        ]});
    }

    onClick(x, y, setAsHit) {
        sendSpywareEvent({kind: 'onClick', x, y, setAsHit});
        const grid = { ...this.state.grid };
        let gridValue = grid[[x, y]];
        let squidsGotten = this.state.squidsGotten;
        this.copyToUndoBuffer();

        if (this.state.mode === 'calculator') {
            const oldValue = gridValue;
            switch (gridValue) {
                case 'MISS':
                    gridValue = 'HIT';
                    break;
                case 'HIT':
                    gridValue = null;
                    break;
                default:
                    gridValue = setAsHit ? 'HIT' : 'MISS';
                    break;
            }
            grid[[x, y]] = gridValue;
            // Manage the third kill so that users don't have to think about it.
            // First, check that the number of hits changed.
            if (gridValue === 'HIT' || oldValue === 'HIT') {
                // Don't change kills from unknown, even if we are certain of the value.
                if (squidsGotten !== 'unknown') {
                    // Only change squid count when the user changes from 8 to 9
                    // or 9 to 8 for the most consistent experience. (This works
                    // in combination with the check that hits changed.)
                    const {hits} = this.getGridStatistics(grid, squidsGotten);
                    squidsGotten = hits.length === 9 ? '3'
                                 : hits.length === 8 && oldValue === 'HIT' ? '2'
                                 : squidsGotten;
                }
            }
        } else {
            // Determine from the random layout.
            if (gridValue !== null)
                return;
            const arrayContains = (arr) => {
                for (const cell of arr)
                    if (cell[0] === x && cell[1] === y)
                        return true;
                return false;
            }
            if (arrayContains([...this.state.squidLayout.squid2, ...this.state.squidLayout.squid3, ...this.state.squidLayout.squid4])) {
                gridValue = 'HIT';
            } else {
                gridValue = 'MISS';
            }
            grid[[x, y]] = gridValue;
            // Compute the killed squid count.
            squidsGotten = 0;
            for (const n of ['2', '3', '4']) {
                const squid = this.state.squidLayout['squid' + n];
                let killed = true;
                for (const cell of squid)
                    if (grid[cell] !== 'HIT')
                        killed = false;
                squidsGotten += killed;
            }
        }
        this.setState({ grid, cursorBelief: [x, y], squidsGotten });
        this.doComputation(grid, squidsGotten);
    }

    clearField() {
        sendSpywareEvent({kind: 'clearField'});
        const templateState = this.makeEmptyState();
        const newState = {};
        for (const name of ['squidLayout', 'grid', 'squidsGotten', 'undoBuffer', 'cursorBelief'])
            newState[name] = templateState[name];
        // The squidsGotten value of 'unknown' is banned in sequence-aware mode.
        if (this.state.sequenceAware)
            newState.squidsGotten = '0';
        this.setState(newState);
        this.doComputation(newState.grid, newState.squidsGotten);
    }

    undoLastMarking() {
        const undoBuffer = [...this.state.undoBuffer];
        if (undoBuffer.length === 0)
            return;
        const undoEntry = undoBuffer.pop();
        sendSpywareEvent({kind: 'undoLastMarking', undoEntry});
        this.setState({grid: undoEntry.grid, squidsGotten: undoEntry.squidsGotten, cursorBelief: undoEntry.cursorBelief, undoBuffer});
        this.doComputation(undoEntry.grid, undoEntry.squidsGotten);
    }

    reportMiss() {
        if (this.state.best !== null && this.state.grid[this.state.best] === null) {
            sendSpywareEvent({kind: 'reportMiss', best: this.state.best, oldGrid: this.state.grid});
            this.onClick(...this.state.best);
        }
    }

    reportHit() {
        if (this.state.best !== null && this.state.grid[this.state.best] === null) {
            sendSpywareEvent({kind: 'reportHit', best: this.state.best, oldGrid: this.state.grid});
            this.onClick(...this.state.best, true);
        }
    }

    async splitTimer() {
        const boardTimer = this.timerRef.current;
        let timerStepEstimate;
        if (boardTimer !== null) {
            const elapsed = boardTimer.getSecondsElapsed();
            // If the timer hasn't been started yet, the purpose of this
            // function call was to start it, not to actually split.
            if (elapsed === 0.0 && !boardTimer.state.invalidated) {
                boardTimer.startRunning();
                return;
            }
            const timerStartMS = performance.now();
            timerStepEstimate = boardTimer.state.invalidated ? null : boardTimer.guessStepsElapsedFromTime(elapsed);

            console.log('Timer step estimate:', timerStepEstimate);
            sendSpywareEvent({ kind: 'splitTimer', invalidated: boardTimer.state.invalidated, timerStepEstimate: timerStepEstimate, elapsed });
            boardTimer.setState({
                timerStartMS,
                // After the first split we're no longer loading the room.
                includesLoadingTheRoom: false,
                includedRewardsGotten: 0,
                timerRunning: true,
                invalidated: false,
            });
        }
        // Automatically copy board to history if it is unambiguous.
        if (await this.copyToHistory()) {
            const squidsGotten = '0';
            const grid = this.makeEmptyGrid();
            // TODO: Allow undoing across completions.
            this.setState({
                    timerStepEstimate,
                    undoBuffer: [],
                    cursorBelief: [0, 7],
                    grid,
                    squidsGotten,
                }, () => {
                    // The copy to history should be done by now, even if it
                    // got batched together with this setState.
                    this.doComputation(grid, squidsGotten);
            });
        } else if (timerStepEstimate !== undefined) {
            // There are still things to update, even if not finishing a board.
            this.setState({ timerStepEstimate }, () => {
                this.doComputation(this.state.grid, this.state.squidsGotten);
            });
        }
    }

    incrementKills() {
        let numericValue = this.state.squidsGotten === 'unknown' ? 0 : Number(this.state.squidsGotten);
        let grid = this.state.grid;
        if (numericValue < 3) {
            this.copyToUndoBuffer();
            numericValue++;
            this.setState({ squidsGotten: '' + numericValue });
            this.doComputation(grid, '' + numericValue);
        }
        sendSpywareEvent({ kind: 'incrementKills', oldGrid: grid, newGrid: grid, newNumericValue: numericValue });
    }

    async copyToHistory(gameHistoryArguments) {
        if (this.state.sequenceAware !== true)
            return;
        const {hits, misses, numericSquidsGotten} = this.getGridStatistics(this.state.grid, this.state.squidsGotten);
        if (gameHistoryArguments === undefined)
            gameHistoryArguments = this.makeGameHistoryArguments();
        await wasm;
        const finalBoard = disambiguate_board(
            Uint8Array.from(hits),
            Uint8Array.from(misses),
            numericSquidsGotten,
            ...gameHistoryArguments,
        );
        if (finalBoard === undefined) {
            // TODO: Show a proper error message in this case!
            sendSpywareEvent({
                kind: 'ambiguousCopyToHistory',
                grid: this.state.grid,
                squidsGotten: this.state.squidsGotten,
                gameHistoryArguments: gameHistoryArguments.map(a => Array.from(a)),
            });
            return false;
        }
        console.log('Final board:', finalBoard);
        sendSpywareEvent({kind: 'copyToHistory', squidLayout: finalBoard});
        const layoutString = this.boardIndexToLayoutString[finalBoard];
        const observedBoards = gameHistoryArguments[0];
        let fillIndex = observedBoards.length;
        // If we're already at capacity then we have to shift the boards over.
        if (fillIndex === this.layoutDrawingBoardRefs.length) {
            this.shiftHistory();
            fillIndex--;
        }
        this.layoutDrawingBoardRefs[fillIndex].current.setStateFromLayoutString(layoutString);
        return true;
    }

    shiftHistory() {
        sendSpywareEvent({kind: 'shiftHistory'});
        const drawingBoards = this.layoutDrawingBoardRefs.map((ref) => ref.current);
        for (let i = 0; i < drawingBoards.length -1; i++) {
            drawingBoards[i].setState(drawingBoards[i + 1].state);
        }
        drawingBoards[drawingBoards.length - 1].clearBoard();
    }

    shortcutsHandler(evt) {
        // Check if the target is an input field that should take precedence over shortcuts.
        if (evt.target?.getAttribute?.('data-stop-shortcuts'))
            return;

        if (evt.altKey)
            return;

        if (evt.ctrlKey) {
            // Prevent modifying an input when undoing.
            if (evt.key.toLowerCase() === 'z' && evt.target?.tagName !== "INPUT") {
                evt.preventDefault();
                this.undoLastMarking();
            }
        } else {
            if (evt.code === 'KeyZ')
                this.reportMiss();
            if (evt.code === 'KeyX')
                this.reportHit();
            if (evt.code === 'KeyC')
                this.incrementKills();
            if (evt.code === 'Space') {
                this.splitTimer();
                evt.preventDefault();
            }
        }
    }

    renderActualMap() {
        return <div style={{justifySelf: 'center'}}>
            {naturalsUpTo(8).map(
                (y) => <div key={y} style={{
                    display: 'flex',
                }}>
                    {naturalsUpTo(8).map(
                        (x) => <Tile
                            key={x + ',' + y}
                            x={x} y={y}
                            onClick={() => this.onClick(x, y)}
                            text={this.state.grid[[x, y]]}
                            prob={this.state.probs[[x, y]]}
                            valid={this.state.valid}
                            best={this.state.best}
                            precision={2}
                        />
                    )}
                </div>
            )}
        </div>;
    }

    render() {
        let usedShots = 0;
        let openingOptimizer = true;
        for (let y = 0; y < 8; y++) {
            for (let x = 0; x < 8; x++) {
                if (this.state.grid[[x, y]] !== null) {
                    usedShots++;
                    if (this.state.grid[[x, y]] === 'HIT')
                        openingOptimizer = false;
                }
            }
        }
        return <div style={{
            margin: '20px',
        }}>
            <div className="container">
                <div style={{justifySelf: "end", alignSelf: "start"}}>
                    <div className="tableContainer" style={{gridTemplateColumns: "repeat(2, 1fr)"}}>
                        <span><strong>&nbsp;Item&nbsp;</strong></span>
                        <span><strong>&nbsp;Value&nbsp;</strong></span>
                        <span>&nbsp;Shots used:&nbsp;</span>
                        <span>&nbsp;{usedShots}&nbsp;</span>
                        {this.state.sequenceAware === true && this.state.usingTimer && <>
                            <BoardTimer ref={this.timerRef} roomEnteredOffset={this.state.roomEnteredOffset} timedTickIntercept={this.state.timedTickIntercept} timedTickRate={this.state.timedTickRate}/>
                            <span>&nbsp;Last steps:&nbsp;</span>
                            <span>&nbsp;{this.state.timerStepEstimate === null ? '-' : this.state.timerStepEstimate}&nbsp;</span>
                        </>}
                        {this.state.sequenceAware === true && this.state.usingTimer && this.state.showKeyShortcuts && <>
                            <span><strong>&nbsp;Control&nbsp;</strong></span><span><strong>&nbsp;Shortcut&nbsp;</strong></span>
                            <span>&nbsp;Start/Split Timer&nbsp;</span><span>&nbsp;Space&nbsp;</span>
                            <span>&nbsp;Add Reward&nbsp;</span><span>&nbsp;,&nbsp;</span>
                            <span>&nbsp;Remove Reward&nbsp;</span><span>&nbsp;Shift+,&nbsp;</span>
                            <span>&nbsp;Invalidate Timer&nbsp;</span><span>&nbsp;;&nbsp;</span>
                            <span>&nbsp;Reset Timer&nbsp;</span><span>&nbsp;Shift+;&nbsp;</span>
                        </>}
                    </div>
                    {this.state.sequenceAware === true && this.state.usingTimer && <>
                        <button style={{ fontSize: '120%', margin: '10px' }} onClick={() => { this.setState({showKeyShortcuts: !this.state.showKeyShortcuts}) }}>Toggle Show Shortcuts</button><br/>
                        <button style={{ fontSize: '120%', margin: '10px' }} onClick={() => { this.setState({spywareMode: !this.state.spywareMode}) }}>{
                            this.state.spywareMode ? <>Disable Spyware Mode</> : <>Enable Spyware Mode</>
                        }</button>
                    </>}
                </div>
                {this.renderActualMap()}
            </div>
            {!this.state.valid && !this.state.sequenceAware && <div style={{ fontSize: '150%' }}>Invalid configuration! This is not possible.</div>}
            <br />
            <div style={{ fontSize: '150%' }}>
                <span>Number of squids killed:</span>
                <select
                    style={{ marginLeft: '20px', fontSize: '100%' }}
                    value={this.state.squidsGotten}
                    onChange={(event) => {
                        this.setState({ squidsGotten: event.target.value });
                        this.doComputation(this.state.grid, event.target.value);
                    }}
                >
                    {/* In sequence-aware mode don't allow unknown, because it's just an accident waiting to happen for a runner. */}
                    {
                        !this.state.sequenceAware &&
                        <option value="unknown">Unknown</option>
                    }
                    <option value="0">0</option>
                    <option value="1">1</option>
                    <option value="2">2</option>
                    <option value="3">3</option>
                </select>
            </div>
            <br/>
            <button style={{ fontSize: '150%', margin: '10px' }} onClick={() => { this.reportMiss(); }}>Miss (z)</button>
            <button style={{ fontSize: '150%', margin: '10px' }} onClick={() => { this.reportHit(); }}>Hit (x)</button>
            <button style={{ fontSize: '150%', margin: '10px' }} onClick={() => { this.incrementKills(); }}>Increment Kills (c)</button>
            {
                this.state.sequenceAware === true &&
                <>
                    <button style={{ fontSize: '150%', margin: '10px' }} onClick={() => { this.shiftHistory(); }}>Shift History</button>
                </>
            }
            <button style={{ fontSize: '150%', margin: '10px' }} onClick={() => { this.clearField(); }}>Reset</button>
            {
                !this.state.sequenceAware &&
                <select
                    style={{ marginLeft: '20px', fontSize: '150%' }}
                    value={this.state.mode}
                    onChange={(event) => this.setState({ mode: event.target.value })}
                >
                    <option value="calculator">Calculator Mode</option>
                    <option value="practice">Practice Mode</option>
                </select>
            }
            {
                this.state.sequenceAware === true &&
                <div className='timerModeSelection'>
                    <span style={{margin: '5px'}}>Timer mode:</span>
                    <input
                        type="checkbox"
                        checked={this.state.usingTimer}
                        onChange={(event) => this.setState({ usingTimer: !this.state.usingTimer })}
                    />
                </div>
            }
            <br />
            {openingOptimizer && this.state.mode === 'calculator' && !this.state.sequenceAware && <>
                <div style={{ fontSize: '120%', marginTop: '20px' }}>
                    Opening optimizer: Probability that this<br />pattern would get at least one hit: {
                        this.state.valid ? ((100 * Math.max(0, 1 - this.state.observationProb)).toFixed(2) + '%') : "Invalid"
                    }
                </div>
            </>}
            <br/>
            {this.state.sequenceAware === 'initializing' && <div style={{ fontSize: '150%' }}>Downloading table...</div>}
            {this.state.sequenceAware === true && <>
                <div>
                    {this.layoutDrawingBoardRefs.map((ref, i) =>
                        <LayoutDrawingBoard parent={this} ref={ref} key={i}/>
                    )}
                </div>
                <hr/>
                <div style={{display:"grid", gridTemplateColumns: "1fr auto 1fr"}}>
                    <div id='settings' style={{ gridColumn: "2" }}>
                        <div style={{ gridColumn: "1 / span 8" }}>Gaussian RNG step count beliefs (all counts in <i>thousands</i> of steps, except "Room entered offset"):</div>
                        <div>First board mean:     </div><input value={this.state.firstBoardStepsThousands}       onChange={event => this.setState({firstBoardStepsThousands: event.target.value})}/>
                        <div>First board stddev:   </div><input value={this.state.firstBoardStepsThousandsStdDev} onChange={event => this.setState({firstBoardStepsThousandsStdDev: event.target.value})}/>
                        <div>Next board mean:      </div><input value={this.state.nextBoardStepsThousands}        onChange={event => this.setState({nextBoardStepsThousands: event.target.value})}/>
                        <div>Next board stddev:    </div><input value={this.state.nextBoardStepsThousandsStdDev}  onChange={event => this.setState({nextBoardStepsThousandsStdDev: event.target.value})}/>
                        <div>Timed board stddev:   </div><input value={this.state.timedBoardStepsThousandsStdDev} onChange={event => this.setState({timedBoardStepsThousandsStdDev: event.target.value})}/>
                        <div>Timed Tick Intercept: </div><input value={this.state.timedTickIntercept}             onChange={event => this.setState({timedTickIntercept: event.target.value})}/>
                        <div>Timed Tick Rate:      </div><input value={this.state.timedTickRate}                  onChange={event => this.setState({timedTickRate: event.target.value})}/>
                        <div>Room entered offset:  </div><input value={this.state.roomEnteredOffset}              onChange={event => this.setState({roomEnteredOffset: event.target.value})}/>
                    </div>
                </div>

                <button style={{ fontSize: '150%', margin: '10px' }} onClick={() => { this.saveConfigParams(); }}>Save Settings</button> &nbsp;
                <button style={{ fontSize: '150%', margin: '10px' }} onClick={() => { this.factoryResetConfigParams(); }}>Reset to Defaults</button>
                <br/>

                <div id='potentialMatches'>
                    {this.state.potentialMatches?.length === 0 ? <div>No Matches Found!</div>
                        : this.state.potentialMatches?.map((match, i) => {
                            const diffs = match.slice(1);
                            return <div key={i}>
                                Potential match: {match[0]}{diffs.map((x, i) => <> +{x - match[i]}</>)}
                            </div>;
                    })}
                </div><br/>
                <button style={{ fontSize: '150%', margin: '10px' }} onClick={() => { this.recomputePotentialMatches(); }}>Find Match Indices</button>
                <div style={{ fontSize: '150%' }}>Sequence-aware mode initialized.</div>
            </>}
            {!this.state.sequenceAware && <div>
                <button style={{ fontSize: '150%', margin: '10px' }} onClick={() => {
                    this.loadSequenceTable(false);
                }}>Initialize Sequence-Aware Mode</button><br/>
                <button style={{ fontSize: '150%', margin: '10px' }} onClick={() => {
                    this.loadSequenceTable(true);
                }}>Initialize Sequence-Aware Mode (big table)</button>
            </div>}

            {this.state.spywareMode && <><SpywareModeConfiguration /><br/></>}

            <span>Last recompute time: {this.state.lastComputationTime.toFixed(2)}ms</span>
        </div>;
    }
}

class App extends React.Component {
    render() {
        return <>
            <div style={{ display: 'inline-block', width: '600px' }}>
                <h1>Sploosh Kaboom Probability Calculator</h1>
                <p>
                    This is a tool for computing the likely locations of squids in the sploosh kaboom minigame of The Legend of Zelda: The Wind Waker (both SD and HD versions).
                    Unfortunately it's currently pretty complicated to use correctly.
                    A collection of tutorials will be compiled at some point, hopefully soon.
                    For now, see the <a href="https://github.com/petersn/web-sploosh-kaboom">GitHub repository</a>.
                </p>
            </div>
            <MainMap />
            <span>Made by Peter Schmidt-Nielsen, CryZe, csunday95, and Amphitryon ({VERSION_STRING})</span>
        </>;
    }
}

export default App;
