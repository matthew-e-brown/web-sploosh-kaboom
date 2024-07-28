import React from 'react';
import interpolate from 'color-interpolate';

// .        . . . .
// 0123456789abcdef
const colorMap = interpolate(['#004', '#070', '#090', '#0b0', '#0d0', '#0f0', '#6f6']);

/**
 * TODO: Add prop descriptions.
 * @typedef Props
 * @property {number} x
 * @property {number} y
 * @property {string} [backgroundColor]
 * @property {string | null} text
 * @property {number} prob
 * @property {boolean} valid
 * @property {[number, number] | null} best
 * @property {number} [precision]
 * @property {() => void} onClick
 * @property {string} [fontSize]
 * @property {number} [opacity]
 */

/**
 * @extends {React.Component<Props>}
 */
export default class Tile extends React.Component {
    render() {
        const { x, y, best, valid, prob, fontSize, opacity, onClick } = this.props;

        const isBest = best !== null && best[0] === x && best[1] === y;
        const className = 'boardTile' + (valid ? '' : ' invalid') + (isBest ? ' selected' : '');

        let { backgroundColor, text } = this.props;

        if (backgroundColor === undefined) {
            switch (text) {
                case null: backgroundColor = colorMap(prob); break;
                case 'HIT': backgroundColor = '#a2a'; break;
                default: backgroundColor = '#44a'; break;
            }
        }

        if (text === null) {
            const { precision } = this.props;
            text = (prob * 100).toFixed(precision) + '%';
        }

        return (
            <div
                className={className}
                key={x + ',' + y}
                style={{ backgroundColor, fontSize, opacity }}
                onClick={onClick}
            >
                {text}
            </div>
        );
    }
}
