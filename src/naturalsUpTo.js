/**
 * @param {number} n The number of numbers to generate.
 * @returns {number[]} An array with the elements `0..n`.
 */
export default function naturalsUpTo(n) {
    const array = new Array(n);
    for (let i = 0; i < n; i++)
        array[i] = i;
    return array;
}
