// file2.js

// Import the Person class from file1.js
const Person = require('./file1');

// Outer function
function calculateArea(shape) {
    let area;

    // Nested function for calculating area of a circle
    function circleArea(radius) {
        return Math.PI * radius * radius;
    }

    // Nested function for calculating area of a rectangle
    function rectangleArea(length, width) {
        return length * width;
    }

    // Determine which shape to calculate
    if (shape === "circle") {
        area = circleArea(5); // Radius of 5
    } else if (shape === "rectangle") {
        area = rectangleArea(4, 6); // Length 4, Width 6
    }

    console.log(`Area of ${shape}: ${area}`);
}

// Call the outer function
calculateArea("circle");
calculateArea("rectangle");

// Create an instance of the imported Person class
const person2 = new Person("Bob", 25);
person2.displayDetails();
person2.nestedMethod();

// Class definition
class Calculator {
    constructor() {
        this.result = 0;
    }

    // Method to add numbers
    add(...numbers) {
        this.result = numbers.reduce((sum, num) => sum + num, 0);
        console.log(`Sum: ${this.result}`);
    }

    // Nested method to reset the result
    resetResult() {
        this.result = 0;
        console.log("Result reset to 0");
    }
}

// Create an instance of the Calculator class
const calculator = new Calculator();
calculator.add(1, 2, 3, 4);
calculator.resetResult();