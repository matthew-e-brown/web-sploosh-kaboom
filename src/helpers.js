/**
 * @template T
 * @typedef {{[key: `${number},${number}`]: T}} Grid
 */


/**
 * Creates an empty grid filled with whatever item is provided.
 * @template T
 * @param {T} fill
 * @returns {Grid<T>}
 */
export function makeGrid(fill) {
    const grid = [];
    for (let y = 0; y < 8; y++)
        for (let x = 0; x < 8; x++)
            grid[[x, y]] = fill;
    return grid;
}


/**
 * @param {number} n The number of numbers to generate.
 * @returns {number[]} An array with the elements `0..n`.
 */
export function naturalsUpTo(n) {
    const array = new Array(n);
    for (let i = 0; i < n; i++)
        array[i] = i;
    return array;
}
