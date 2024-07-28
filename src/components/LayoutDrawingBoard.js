import React from 'react';
import Tile from './Tile';
import { naturalsUpTo, makeGrid } from '../helpers';


/**
 * @typedef {import('../helpers').Grid<'2' | '3' | '4' | '.'>} LayoutGrid
 */

/**
 * @typedef Props
 * @property {Record<string, number>} boardIndices
 */

/**
 * @typedef State
 * @property {[number, number] | null} selectedCell
 * @property {LayoutGrid} grid
 */


/**
 * @extends {React.Component<Props, State>}
 */
export default class LayoutDrawingBoard extends React.Component {
    state = {
        grid: makeGrid('.'),
        selectedCell: null,
    };

    clearBoard() {
        this.setState({
            grid: makeGrid('.'),
            selectedCell: null,
        });
    }

    /**
     * @param {number} x
     * @param {number} y
     */
    onClick(x, y) {
        if (this.state.selectedCell === null) {
            this.setState({ selectedCell: [x, y] });
            return;
        }

        const grid = { ...this.state.grid };
        const [selX, selY] = this.state.selectedCell;
        let changeMade = false;

        for (const length of [2, 3, 4]) {
            for (const [dx, dy] of [[+1, 0], [0, +1], [-1, 0], [0, -1]]) {
                if (selX === x + dx * (length - 1) && selY === y + dy * (length - 1)) {
                    // If this squid appears anywhere else, obliterate it.
                    for (let y = 0; y < 8; y++)
                        for (let x = 0; x < 8; x++)
                            if (grid[[x, y]] === length.toString())
                                grid[[x, y]] = '.';

                    // Fill in the squid here.
                    for (let i = 0; i < length; i++)
                        grid[[x + i * dx, y + i * dy]] = length.toString();

                    changeMade = true;
                }
            }
        }

        // If any squid has the wrong count, then totally eliminate it.
        const countsBySquid = { '2': 0, '3': 0, '4': 0, '.': 0 };
        for (let y = 0; y < 8; y++)
            for (let x = 0; x < 8; x++)
                countsBySquid[grid[[x, y]]]++;

        for (const length of [2, 3, 4]) {
            if (countsBySquid[length.toString()] !== length) {
                // Obliterate:
                for (let y = 0; y < 8; y++)
                    for (let x = 0; x < 8; x++)
                        if (grid[[x, y]] === '' + length)
                            grid[[x, y]] = '.';
            }
        }

        if (changeMade) {
            this.setState({ grid });
        }

        this.setState({ selectedCell: null });
    }

    /**
     * @returns {string}
     */
    getLayoutString() {
        let layoutString = '';
        for (let y = 0; y < 8; y++)
            for (let x = 0; x < 8; x++)
                layoutString += this.state.grid[[x, y]];
        return layoutString;
    }

    /**
     * @param {string} layoutString
     */
    setStateFromLayoutString(layoutString) {
        const grid = [];
        for (let y = 0; y < 8; y++)
            for (let x = 0; x < 8; x++)
                grid[[x, y]] = layoutString[x + 8 * y];
        this.setState({ grid });
    }

    render() {
        const { grid, selectedCell } = this.state;
        const { boardIndices } = this.props;

        const layoutString = this.getLayoutString();
        const squidLayout = boardIndices[layoutString] ?? "waiting...";

        const opacity = (x, y) => {
            if (selectedCell !== null && x === selectedCell[0] && y === selectedCell[1]) {
                return 0.6;
            } else {
                return 0.2;
            }
        }

        return (
            <div className='historyBoardContainer'>
                <div className='historyBoard'>
                    {naturalsUpTo(8).map(y => (
                        <div key={y} style={{ display: 'flex' }}>
                            {naturalsUpTo(8).map(x => (
                                <Tile
                                    key={x + ',' + y}
                                    x={x}
                                    y={y}
                                    onClick={() => this.onClick(x, y)}
                                    text={grid[[x, y]]}
                                    best={selectedCell}
                                    fontSize='200%'
                                    opacity={opacity(x, y)}
                                    valid
                                />
                            ))}
                        </div>
                    ))}
                </div>
                <br />
                Squid Layout: {squidLayout}
            </div>
        );
    }
}
