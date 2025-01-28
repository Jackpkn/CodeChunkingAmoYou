// file1.js

// Outer function
function outerFunction() {
  let outerVariable = "I'm from the outer function!";

  // Nested function
  function innerFunction() {
      let innerVariable = "I'm from the inner function!";
      console.log(outerVariable); // Access outer variable
      console.log(innerVariable); // Access inner variable
  }

  // Call the nested function
  innerFunction();
}

// Call the outer function
outerFunction();

// Class definition
class Person {
  constructor(name, age) {
      this.name = name;
      this.age = age;
  }

  // Method to display person details
  displayDetails() {
      console.log(`Name: ${this.name}, Age: ${this.age}`);
  }

  // Nested method
  nestedMethod() {
      console.log(`This is a nested method for ${this.name}`);
  }
}

// Create an instance of the Person class
const person1 = new Person("Alice", 30);
person1.displayDetails();
person1.nestedMethod();

// Export the Person class for use in other files
module.exports = Person;