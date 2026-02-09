# MongoDB Deep Dive: CRUD and Aggregation Pipeline

## Table of Contents
1. [CRUD Operations](#crud-operations)
2. [Query Operators](#query-operators)
3. [Update Operators](#update-operators)
4. [Array Operations](#array-operations)
5. [Projection and Cursors](#projection-and-cursors)
6. [Aggregation Pipeline](#aggregation-pipeline)
7. [Spring Data MongoDB](#spring-data-mongodb)
8. [Common Interview Questions](#common-interview-questions)

---

## CRUD Operations

### Create (Insert)

#### insertOne - Insert Single Document

```javascript
// Mongo Shell
db.users.insertOne({
  name: "Alice Johnson",
  email: "alice@example.com",
  age: 28,
  roles: ["user", "editor"],
  created_at: ISODate()
})

// Returns: { acknowledged: true, insertedId: ObjectId(...) }
```

**Spring Data MongoDB:**
```java
@Document(collection = "users")
public class User {
    @Id
    private String id;
    private String name;
    private String email;
    private Integer age;
    private List<String> roles;
    private LocalDateTime createdAt;
}

@Service
public class UserService {
    @Autowired
    private MongoTemplate mongoTemplate;

    public User createUser(User user) {
        user.setCreatedAt(LocalDateTime.now());
        return mongoTemplate.insert(user);  // insertOne
    }
}
```

#### insertMany - Insert Multiple Documents

```javascript
// Mongo Shell
db.users.insertMany([
  { name: "Alice", email: "alice@example.com", age: 28 },
  { name: "Bob", email: "bob@example.com", age: 32 },
  { name: "Charlie", email: "charlie@example.com", age: 26 }
])

// With options
db.users.insertMany(
  [{ ... }, { ... }],
  { ordered: false }  // Continue on error, don't stop at first failure
)
```

**Spring Data MongoDB:**
```java
public List<User> createUsers(List<User> users) {
    return mongoTemplate.insertAll(users);
}

// Using repository
@Repository
public interface UserRepository extends MongoRepository<User, String> {
}

@Service
public class UserService {
    @Autowired
    private UserRepository userRepository;

    public List<User> createUsers(List<User> users) {
        return userRepository.saveAll(users);
    }
}
```

### Read (Query)

#### find - Query Documents

```javascript
// Mongo Shell - basic find
db.users.find()                          // All documents
db.users.find({ age: 28 })               // Exact match
db.users.find({ age: { $gt: 25 } })      // Conditions
db.users.find(
  { age: { $gt: 25 } },
  { name: 1, email: 1, _id: 0 }          // Projection
)
```

**Spring Data MongoDB:**
```java
// Using MongoTemplate
public List<User> findUsersByAge(Integer age) {
    Query query = new Query(Criteria.where("age").gt(age));
    return mongoTemplate.find(query, User.class);
}

public User findUserByEmail(String email) {
    Query query = new Query(Criteria.where("email").is(email));
    return mongoTemplate.findOne(query, User.class);
}

// Using MongoRepository
@Repository
public interface UserRepository extends MongoRepository<User, String> {
    List<User> findByAgeGreaterThan(Integer age);
    User findByEmail(String email);
    List<User> findByAgeGreaterThanAndRolesContaining(Integer age, String role);
}

@Service
public class UserService {
    @Autowired
    private UserRepository userRepository;

    public List<User> getUsersOver25() {
        return userRepository.findByAgeGreaterThan(25);
    }
}
```

#### findOne - Get Single Document

```javascript
// Mongo Shell
db.users.findOne({ email: "alice@example.com" })

// With sorted fetch
db.users.findOne({ age: { $gt: 25 } }, { name: 1 })
```

**Spring Data MongoDB:**
```java
public Optional<User> getUserByEmail(String email) {
    Query query = new Query(Criteria.where("email").is(email));
    return Optional.ofNullable(mongoTemplate.findOne(query, User.class));
}

// Or with repository
public Optional<User> findByEmail(String email) {
    return userRepository.findByEmail(email);
}
```

### Update

#### updateOne - Update Single Document

```javascript
// Mongo Shell
db.users.updateOne(
  { _id: ObjectId("507f1f77bcf86cd799439011") },
  { $set: { age: 29, updated_at: ISODate() } }
)

// Returns: { acknowledged: true, matchedCount: 1, modifiedCount: 1 }
```

**Spring Data MongoDB:**
```java
public void updateUserAge(String userId, Integer newAge) {
    Query query = new Query(Criteria.where("_id").is(userId));
    Update update = new Update()
        .set("age", newAge)
        .set("updatedAt", LocalDateTime.now());
    mongoTemplate.updateFirst(query, update, User.class);
}

// With repository
@Repository
public interface UserRepository extends MongoRepository<User, String> {
    @Query("{ '_id': ?0 }")
    void updateAge(String userId, int age);
}
```

#### updateMany - Update Multiple Documents

```javascript
// Mongo Shell
db.users.updateMany(
  { roles: "user" },
  { $set: { active: true }, $inc: { loginCount: 1 } }
)

// Only update if condition not met
db.users.updateMany(
  { roles: "user", premium: { $exists: false } },
  { $set: { premium: false } }
)
```

**Spring Data MongoDB:**
```java
public void activateAllUsers() {
    Query query = new Query(Criteria.where("roles").in("user"));
    Update update = new Update()
        .set("active", true)
        .inc("loginCount", 1);
    mongoTemplate.updateMulti(query, update, User.class);
}
```

#### replaceOne - Replace Entire Document

```javascript
// Mongo Shell
db.users.replaceOne(
  { _id: ObjectId("507f1f77bcf86cd799439011") },
  {
    name: "Alice Updated",
    email: "alice.new@example.com",
    age: 29,
    roles: ["admin"],
    updated_at: ISODate()
  }
)
```

**Spring Data MongoDB:**
```java
public void replaceUser(String userId, User newUser) {
    newUser.setId(userId);
    mongoTemplate.save(newUser);  // Replaces entire document
}
```

### Delete

#### deleteOne - Delete Single Document

```javascript
// Mongo Shell
db.users.deleteOne({ _id: ObjectId("507f1f77bcf86cd799439011") })

// Returns: { acknowledged: true, deletedCount: 1 }
```

**Spring Data MongoDB:**
```java
public void deleteUser(String userId) {
    Query query = new Query(Criteria.where("_id").is(userId));
    mongoTemplate.remove(query, User.class);
}

// With repository
public void deleteUser(String userId) {
    userRepository.deleteById(userId);
}
```

#### deleteMany - Delete Multiple Documents

```javascript
// Mongo Shell
db.users.deleteMany({ active: false, inactiveDate: { $lt: ISODate("2023-01-01") } })

// Delete all documents in collection
db.users.deleteMany({})
```

**Spring Data MongoDB:**
```java
public void deleteInactiveUsers() {
    Query query = new Query(
        Criteria.where("active").is(false)
            .and("inactiveDate").lt(LocalDateTime.of(2023, 1, 1, 0, 0))
    );
    mongoTemplate.remove(query, User.class);
}
```

---

## Query Operators

### Comparison Operators

```javascript
// $eq - Equal (default if not specified)
db.users.find({ age: { $eq: 28 } })
db.users.find({ age: 28 })  // Same as above

// $ne - Not equal
db.users.find({ status: { $ne: "inactive" } })

// $gt - Greater than
db.users.find({ age: { $gt: 25 } })

// $gte - Greater than or equal
db.users.find({ age: { $gte: 25 } })

// $lt - Less than
db.users.find({ age: { $lt: 30 } })

// $lte - Less than or equal
db.users.find({ age: { $lte: 30 } })

// $in - In array
db.users.find({ status: { $in: ["active", "pending"] } })

// $nin - Not in array
db.users.find({ status: { $nin: ["deleted", "banned"] } })
```

**Spring Data MongoDB:**
```java
// $eq
userRepository.findByAge(28);

// $ne
List<User> active = mongoTemplate.find(
    new Query(Criteria.where("status").ne("inactive")),
    User.class
);

// $gt, $gte, $lt, $lte
List<User> adultUsers = mongoTemplate.find(
    new Query(Criteria.where("age").gte(18).lt(65)),
    User.class
);

// $in
List<User> statusUsers = mongoTemplate.find(
    new Query(Criteria.where("status").in("active", "pending")),
    User.class
);

// $nin
List<User> validUsers = mongoTemplate.find(
    new Query(Criteria.where("status").nin("deleted", "banned")),
    User.class
);
```

### Logical Operators

```javascript
// $and - All conditions true
db.users.find({
  $and: [
    { age: { $gt: 25 } },
    { status: "active" }
  ]
})
// Or implicit (more readable)
db.users.find({ age: { $gt: 25 }, status: "active" })

// $or - Any condition true
db.users.find({
  $or: [
    { status: "vip" },
    { age: { $lt: 18 } }
  ]
})

// $nor - None of conditions true
db.users.find({
  $nor: [
    { status: "deleted" },
    { banned: true }
  ]
})

// $not - Negate a condition
db.users.find({ age: { $not: { $lt: 18 } } })  // age >= 18
```

**Spring Data MongoDB:**
```java
// $and - implicit
List<User> users = mongoTemplate.find(
    new Query(
        Criteria.where("age").gt(25)
            .and("status").is("active")
    ),
    User.class
);

// $or - explicit
List<User> orUsers = mongoTemplate.find(
    new Query(
        new Criteria().orOperator(
            Criteria.where("status").is("vip"),
            Criteria.where("age").lt(18)
        )
    ),
    User.class
);
```

### Element Operators

```javascript
// $exists - Field exists
db.users.find({ email: { $exists: true } })      // Has email
db.users.find({ email: { $exists: false } })     // No email

// $type - Field is specific BSON type
db.users.find({ age: { $type: "int" } })         // Is integer
db.users.find({ createdAt: { $type: "date" } })  // Is date

// Possible types: "double", "string", "object", "array", "binData",
//                 "objectId", "bool", "date", "null", "int", "long",
//                 "decimal", "timestamp", "regex"
```

**Spring Data MongoDB:**
```java
// $exists
List<User> withEmail = mongoTemplate.find(
    new Query(Criteria.where("email").exists(true)),
    User.class
);

List<User> noEmail = mongoTemplate.find(
    new Query(Criteria.where("email").exists(false)),
    User.class
);
```

### String Operators

```javascript
// $regex - Regular expression matching
db.users.find({ email: { $regex: "example.com$" } })

// Case-insensitive regex
db.users.find({ email: { $regex: "EXAMPLE", $options: "i" } })

// Starts with pattern
db.users.find({ name: { $regex: "^Alice" } })

// Contains pattern
db.users.find({ bio: { $regex: "software engineer", $options: "i" } })
```

**Spring Data MongoDB:**
```java
List<User> exampleUsers = mongoTemplate.find(
    new Query(Criteria.where("email").regex("example.com$")),
    User.class
);

// Case-insensitive
List<User> searchResults = mongoTemplate.find(
    new Query(Criteria.where("bio")
        .regex("software engineer", "i")),
    User.class
);
```

### Array Operators

```javascript
// $elemMatch - At least one array element matches all conditions
db.orders.find({
  items: {
    $elemMatch: { productId: "PROD-001", quantity: { $gt: 5 } }
  }
})

// $size - Array has specific length
db.users.find({ roles: { $size: 2 } })

// $all - Array contains all specified elements
db.users.find({ tags: { $all: ["mongodb", "database"] } })
```

**Spring Data MongoDB:**
```java
// $elemMatch
List<Order> orders = mongoTemplate.find(
    new Query(
        Criteria.where("items")
            .elemMatch(new Criteria()
                .and("productId").is("PROD-001")
                .and("quantity").gt(5)
            )
    ),
    Order.class
);

// $size
List<User> twoRoles = mongoTemplate.find(
    new Query(Criteria.where("roles").size(2)),
    User.class
);

// $all
List<User> tagged = mongoTemplate.find(
    new Query(Criteria.where("tags").all("mongodb", "database")),
    User.class
);
```

---

## Update Operators

### Field Update Operators

```javascript
// $set - Set field value
db.users.updateOne(
  { _id: ObjectId() },
  { $set: { age: 29, email: "new@example.com" } }
)

// $unset - Remove field
db.users.updateOne(
  { _id: ObjectId() },
  { $unset: { tempField: "" } }
)

// $inc - Increment numeric field
db.users.updateOne(
  { _id: ObjectId() },
  { $inc: { age: 1, loginCount: 5 } }
)

// $mul - Multiply numeric field
db.products.updateOne(
  { _id: ObjectId() },
  { $mul: { price: 1.1 } }  // 10% increase
)

// $min - Set if new value is less
db.users.updateOne(
  { _id: ObjectId() },
  { $min: { lowestScore: 42 } }
)

// $max - Set if new value is greater
db.users.updateOne(
  { _id: ObjectId() },
  { $max: { highestScore: 100 } }
)

// $rename - Rename field
db.users.updateOne(
  { _id: ObjectId() },
  { $rename: { "oldFieldName": "newFieldName" } }
)

// $currentDate - Set to current date
db.users.updateOne(
  { _id: ObjectId() },
  { $currentDate: { lastModified: true } }
)
```

**Spring Data MongoDB:**
```java
public void updateUser(String userId) {
    Update update = new Update()
        .set("age", 29)
        .set("email", "new@example.com")
        .inc("loginCount", 1)
        .unset("tempField");

    mongoTemplate.updateFirst(
        new Query(Criteria.where("_id").is(userId)),
        update,
        User.class
    );
}

// Multiply price
Update priceUpdate = new Update()
    .multiply("price", 1.1);
mongoTemplate.updateFirst(query, priceUpdate, Product.class);

// Rename field
Update renameUpdate = new Update()
    .rename("oldName", "newName");
mongoTemplate.updateFirst(query, renameUpdate, User.class);
```

### Array Update Operators

```javascript
// $push - Add element to array
db.users.updateOne(
  { _id: ObjectId() },
  { $push: { tags: "mongodb" } }
)

// $push with $each - Add multiple elements
db.users.updateOne(
  { _id: ObjectId() },
  { $push: { tags: { $each: ["nosql", "database", "json"] } } }
)

// $push with $sort and $slice - Sort and limit array size
db.users.updateOne(
  { _id: ObjectId() },
  {
    $push: {
      recentScores: {
        $each: [85, 92, 78],
        $sort: -1,    // Sort descending
        $slice: 5     // Keep only top 5
      }
    }
  }
)

// $pull - Remove elements matching condition
db.users.updateOne(
  { _id: ObjectId() },
  { $pull: { tags: "deprecated" } }
)

// $pull array of values
db.users.updateOne(
  { _id: ObjectId() },
  { $pull: { tags: { $in: ["old", "legacy", "deprecated"] } } }
)

// $addToSet - Add element only if not already present
db.users.updateOne(
  { _id: ObjectId() },
  { $addToSet: { tags: "mongodb" } }  // Won't add duplicate
)

// $addToSet with $each
db.users.updateOne(
  { _id: ObjectId() },
  { $addToSet: { tags: { $each: ["java", "spring"] } } }
)

// $pop - Remove first/last array element
db.users.updateOne(
  { _id: ObjectId() },
  { $pop: { tags: 1 } }    // Remove last
)
db.users.updateOne(
  { _id: ObjectId() },
  { $pop: { tags: -1 } }   // Remove first
)

// Positional $ operator - Update array element by position
db.orders.updateOne(
  { _id: ObjectId(), "items.productId": "PROD-001" },
  { $set: { "items.$.quantity": 5 } }  // Update matching array element
)

// $[] operator - Update all array elements
db.orders.updateOne(
  { _id: ObjectId() },
  { $inc: { "items[].quantity": 1 } }  // Increment all item quantities
)
```

**Spring Data MongoDB:**
```java
// $push
Update update = new Update()
    .push("tags").value("mongodb");
mongoTemplate.updateFirst(query, update, User.class);

// $push multiple
Update update = new Update()
    .push("tags").each("nosql", "database", "json");
mongoTemplate.updateFirst(query, update, User.class);

// $pull
Update update = new Update()
    .pull("tags", "deprecated");
mongoTemplate.updateFirst(query, update, User.class);

// $addToSet
Update update = new Update()
    .addToSet("tags").value("mongodb");
mongoTemplate.updateFirst(query, update, User.class);

// Positional update - Spring Data doesn't support $ operator natively
// Use mongoTemplate.updateMulti with custom queries
```

---

## Array Operations Examples

```javascript
// Practical: Comments on a blog post (unbounded array)
db.posts.insertOne({
  _id: ObjectId(),
  title: "MongoDB Guide",
  comments: [
    { _id: 1, author: "Alice", text: "Great post!" },
    { _id: 2, author: "Bob", text: "Very helpful" }
  ]
})

// Add new comment
db.posts.updateOne(
  { _id: ObjectId() },
  {
    $push: {
      comments: {
        _id: 3,
        author: "Charlie",
        text: "Thanks for sharing!"
      }
    }
  }
)

// Remove comment by author
db.posts.updateOne(
  { _id: ObjectId() },
  { $pull: { comments: { author: "Bob" } } }
)

// Update comment text (positional)
db.posts.updateOne(
  { _id: ObjectId(), "comments.author": "Alice" },
  { $set: { "comments.$.text": "Updated comment" } }
)

// Keep only latest 100 comments
db.posts.updateOne(
  { _id: ObjectId() },
  {
    $push: {
      comments: {
        $each: [{ _id: newId, author: "Dave", text: "..." }],
        $sort: { _id: -1 },
        $slice: 100
      }
    }
  }
)
```

---

## Projection and Cursors

### Projection - Select Fields

```javascript
// Include specific fields (exclude _id automatically)
db.users.find(
  { age: { $gt: 25 } },
  { name: 1, email: 1, _id: 0 }
)

// Exclude specific fields
db.users.find(
  { age: { $gt: 25 } },
  { password: 0, internalNotes: 0 }
)

// Array slicing in projection
db.posts.find(
  { _id: ObjectId() },
  { comments: { $slice: 5 } }  // First 5 comments
)

// Array slicing with skip and limit
db.posts.find(
  { _id: ObjectId() },
  { comments: { $slice: [10, 5] } }  // Skip 10, then get 5
)

// Nested field projection
db.users.find(
  { age: { $gt: 25 } },
  { "address.city": 1, "address.zip": 1, _id: 0 }
)

// $elemMatch in projection (matching array elements)
db.posts.find(
  { _id: ObjectId() },
  { comments: { $elemMatch: { score: { $gt: 5 } } } }
)
```

**Spring Data MongoDB:**
```java
public List<User> getUsersSummary() {
    Query query = new Query(Criteria.where("age").gt(25));
    query.fields()
        .include("name", "email")
        .exclude("_id");
    return mongoTemplate.find(query, User.class);
}

// Or use custom projection
List<?> results = mongoTemplate.find(
    new Query()
        .fields()
        .include("name", "email")
        .exclude("_id"),
    User.class
);
```

### Cursor Methods

```javascript
// sort - Order results
db.users.find().sort({ age: -1, name: 1 })  // Desc age, asc name

// limit - Maximum results
db.users.find({ age: { $gt: 25 } }).limit(10)

// skip - Offset results (for pagination)
db.users.find({ age: { $gt: 25 } }).skip(20).limit(10)  // Results 20-30

// count - Count matching documents
db.users.find({ age: { $gt: 25 } }).count()

// Combine cursor methods
db.users.find({ age: { $gt: 25 } })
  .sort({ createdAt: -1 })
  .skip(0)
  .limit(20)
```

**Spring Data MongoDB:**
```java
public List<User> getUsersPaginated(int page, int pageSize) {
    Query query = new Query(Criteria.where("age").gt(25))
        .with(Sort.by(Sort.Direction.DESC, "createdAt"))
        .skip((page - 1) * pageSize)
        .limit(pageSize);
    return mongoTemplate.find(query, User.class);
}

// Or using Page
@Repository
public interface UserRepository extends MongoRepository<User, String>,
        PagingAndSortingRepository<User, String> {
    Page<User> findByAgeGreaterThan(Integer age, Pageable pageable);
}

@Service
public class UserService {
    @Autowired
    private UserRepository userRepository;

    public Page<User> getUsersPaginated(int page, int pageSize) {
        Pageable pageable = PageRequest.of(page - 1, pageSize,
            Sort.by(Sort.Direction.DESC, "createdAt"));
        return userRepository.findByAgeGreaterThan(25, pageable);
    }
}
```

---

## Aggregation Pipeline

The aggregation pipeline processes data through multiple stages, transforming documents as they pass through.

```
Input Documents
    ↓
[$match]  - Filter documents
    ↓
[$group]  - Group by field, calculate aggregations
    ↓
[$project] - Reshape documents, include/exclude fields
    ↓
[$sort]   - Order results
    ↓
[$limit]  - Limit output
    ↓
Output Documents
```

### Stage 1: $match - Filter Documents

```javascript
// $match early in pipeline for efficiency
db.orders.aggregate([
  {
    $match: {
      status: "completed",
      total: { $gt: 100 }
    }
  },
  { $group: { _id: "$customerId", totalSpent: { $sum: "$total" } } }
])
```

**Spring Data MongoDB:**
```java
List<Object> results = mongoTemplate.aggregate(
    Aggregation.newAggregation(
        Aggregation.match(
            Criteria.where("status").is("completed")
                .and("total").gt(100)
        ),
        Aggregation.group("customerId")
            .sum("total").as("totalSpent")
    ),
    "orders",
    Object.class
).getMappedResults();
```

### Stage 2: $group - Group and Aggregate

```javascript
// Count documents per group
db.users.aggregate([
  {
    $group: {
      _id: "$role",           // Group by role field
      count: { $sum: 1 }      // Count documents
    }
  }
])

// Result: [
//   { _id: "admin", count: 5 },
//   { _id: "user", count: 42 }
// ]

// Multiple aggregations per group
db.orders.aggregate([
  {
    $group: {
      _id: "$customerId",
      totalOrders: { $sum: 1 },
      totalSpent: { $sum: "$total" },
      averageOrder: { $avg: "$total" },
      maxOrder: { $max: "$total" },
      minOrder: { $min: "$total" },
      distinctProducts: { $addToSet: "$productId" }
    }
  }
])

// Group by null to aggregate across all documents
db.sales.aggregate([
  {
    $group: {
      _id: null,
      totalRevenue: { $sum: "$amount" },
      averageSale: { $avg: "$amount" },
      count: { $sum: 1 }
    }
  }
])

// Group by multiple fields
db.sales.aggregate([
  {
    $group: {
      _id: {
        year: { $year: "$date" },
        month: { $month: "$date" },
        region: "$region"
      },
      totalSales: { $sum: "$amount" }
    }
  }
])
```

**Spring Data MongoDB:**
```java
// Count per role
List<Map> results = mongoTemplate.aggregate(
    Aggregation.newAggregation(
        Aggregation.group("role")
            .count().as("count")
    ),
    "users",
    Map.class
).getMappedResults();

// Multiple aggregations
TypedAggregation<Order> aggregation = Aggregation.newAggregation(Order.class,
    Aggregation.group("customerId")
        .count().as("totalOrders")
        .sum("total").as("totalSpent")
        .avg("total").as("averageOrder")
        .max("total").as("maxOrder")
        .min("total").as("minOrder")
        .addToSet("productId").as("distinctProducts")
);

List<OrderStats> stats = mongoTemplate.aggregate(aggregation, OrderStats.class)
    .getMappedResults();
```

### Stage 3: $project - Reshape Documents

```javascript
// Include/exclude fields
db.users.aggregate([
  {
    $project: {
      name: 1,
      email: 1,
      _id: 0
    }
  }
])

// Compute new fields
db.users.aggregate([
  {
    $project: {
      name: 1,
      age: 1,
      isAdult: { $gte: ["$age", 18] },  // Boolean expression
      decade: { $floor: { $divide: ["$age", 10] } }  // Math expression
    }
  }
])

// String operations
db.users.aggregate([
  {
    $project: {
      name: 1,
      email: 1,
      domain: {
        $arrayElemAt: [
          { $split: ["$email", "@"] },  // Split email
          1  // Get domain part
        ]
      }
    }
  }
])

// Conditional fields
db.users.aggregate([
  {
    $project: {
      name: 1,
      age: 1,
      ageGroup: {
        $cond: [
          { $lt: ["$age", 18] },
          "minor",
          { $cond: [{ $lt: ["$age", 65] }, "adult", "senior"] }
        ]
      }
    }
  }
])

// Nested field creation
db.users.aggregate([
  {
    $project: {
      name: 1,
      contact: {
        email: "$email",
        phone: "$phone"
      }
    }
  }
])
```

**Spring Data MongoDB:**
```java
List<UserProjection> results = mongoTemplate.aggregate(
    Aggregation.newAggregation(
        Aggregation.project("name", "email")
            .andExclude("_id")
            .andExpression("(age >= 18) ? 'adult' : 'minor'").as("ageGroup")
    ),
    "users",
    UserProjection.class
).getMappedResults();
```

### Stage 4: $sort - Order Results

```javascript
db.users.aggregate([
  { $sort: { age: -1, name: 1 } }  // Desc age, asc name
])

// Sort inside group
db.orders.aggregate([
  {
    $group: {
      _id: "$customerId",
      orders: { $push: "$$ROOT" }  // $$ROOT = entire document
    }
  },
  {
    $project: {
      customerId: "$_id",
      orders: {
        $slice: [
          { $sort: { $each: "$orders", $sort: { date: -1 } } },
          10  // Top 10 latest orders
        ]
      }
    }
  }
])
```

### Stage 5: $limit and $skip - Pagination

```javascript
db.users.aggregate([
  { $match: { age: { $gt: 25 } } },
  { $sort: { createdAt: -1 } },
  { $skip: 20 },
  { $limit: 10 }
])
```

### Stage 6: $unwind - Deconstruct Arrays

Converts array field into multiple documents (one per element).

```javascript
// Without $unwind
db.orders.findOne({ _id: 1 })
// Result: { _id: 1, customerId: "C1", items: [
//   { productId: "P1", qty: 2 },
//   { productId: "P2", qty: 1 }
// ]}

// With $unwind
db.orders.aggregate([
  { $match: { _id: 1 } },
  { $unwind: "$items" }
])
// Result: [
//   { _id: 1, customerId: "C1", items: { productId: "P1", qty: 2 } },
//   { _id: 1, customerId: "C1", items: { productId: "P2", qty: 1 } }
// ]

// $unwind with preserveNullAndEmptyArrays
db.orders.aggregate([
  {
    $unwind: {
      path: "$items",
      preserveNullAndEmptyArrays: true  // Keep docs with no items
    }
  }
])

// Multiple unwinding
db.inventory.aggregate([
  { $unwind: "$sizes" },
  { $unwind: "$colors" }
  // Creates all combinations
])
```

### Stage 7: $lookup - Join Collections

Similar to SQL LEFT JOIN.

```javascript
// Schema:
// db.orders: [{ _id: 1, userId: "U1", total: 450 }]
// db.users: [{ _id: "U1", name: "Alice", email: "alice@example.com" }]

db.orders.aggregate([
  {
    $lookup: {
      from: "users",           // Join with users collection
      localField: "userId",    // Field in orders
      foreignField: "_id",     // Field in users
      as: "user"               // Output array field name
    }
  }
])

// Result: [
//   {
//     _id: 1,
//     userId: "U1",
//     total: 450,
//     user: [
//       { _id: "U1", name: "Alice", email: "alice@example.com" }
//     ]
//   }
// ]

// With $unwind to flatten
db.orders.aggregate([
  {
    $lookup: {
      from: "users",
      localField: "userId",
      foreignField: "_id",
      as: "user"
    }
  },
  { $unwind: "$user" }  // Convert array to object
])

// Lookup with pipeline (MongoDB 3.6+)
db.orders.aggregate([
  {
    $lookup: {
      from: "users",
      let: { userId: "$userId" },  // Variable from orders
      pipeline: [
        { $match: { $expr: { $eq: ["$_id", "$$userId"] } } },
        { $project: { password: 0 } }  // Filter fields
      ],
      as: "user"
    }
  },
  { $unwind: "$user" }
])
```

**Spring Data MongoDB:**
```java
List<OrderWithUser> results = mongoTemplate.aggregate(
    Aggregation.newAggregation(
        Aggregation.lookup("users", "userId", "_id", "user"),
        Aggregation.unwind("user")
    ),
    "orders",
    OrderWithUser.class
).getMappedResults();
```

### Stage 8: $facet - Multiple Aggregations

Run multiple pipelines in one aggregation.

```javascript
// Get counts for different statuses and top products in one query
db.orders.aggregate([
  {
    $facet: {
      statusCount: [
        { $group: { _id: "$status", count: { $sum: 1 } } }
      ],
      topProducts: [
        { $group: { _id: "$productId", totalQty: { $sum: "$quantity" } } },
        { $sort: { totalQty: -1 } },
        { $limit: 5 }
      ],
      customerStats: [
        { $group: { _id: "$customerId", totalSpent: { $sum: "$total" } } },
        { $sort: { totalSpent: -1 } },
        { $limit: 10 }
      ]
    }
  }
])

// Result: {
//   statusCount: [{ _id: "completed", count: 1000 }, ...],
//   topProducts: [{ _id: "P1", totalQty: 5000 }, ...],
//   customerStats: [{ _id: "C1", totalSpent: 15000 }, ...]
// }
```

### Stage 9: $bucket and $bucketAuto - Categorize Values

```javascript
// Explicit buckets
db.users.aggregate([
  {
    $bucket: {
      groupBy: "$age",
      boundaries: [0, 18, 25, 35, 50, 100],
      default: "other",
      output: { count: { $sum: 1 } }
    }
  }
])

// Result: [
//   { _id: 0, count: 10 },      // 0-18
//   { _id: 18, count: 25 },     // 18-25
//   { _id: 25, count: 40 },     // 25-35
//   { _id: 35, count: 35 },     // 35-50
//   { _id: 50, count: 15 },     // 50-100
//   { _id: "other", count: 5 }
// ]

// Auto buckets (MongoDB calculates buckets)
db.sales.aggregate([
  {
    $bucketAuto: {
      groupBy: "$total",
      buckets: 5,  // Create 5 buckets automatically
      output: { count: { $sum: 1 }, avgTotal: { $avg: "$total" } }
    }
  }
])
```

### Stage 10: $graphLookup - Recursive Queries

```javascript
// Employee hierarchy: employee -> manager -> higher manager
db.employees.insertMany([
  { _id: 1, name: "Alice", managerId: null },     // CEO
  { _id: 2, name: "Bob", managerId: 1 },          // Reports to Alice
  { _id: 3, name: "Charlie", managerId: 1 },      // Reports to Alice
  { _id: 4, name: "Dave", managerId: 2 },         // Reports to Bob
  { _id: 5, name: "Eve", managerId: 2 }           // Reports to Bob
])

// Find all employees in chain of command for Dave
db.employees.aggregate([
  {
    $match: { _id: 4 }  // Start with Dave
  },
  {
    $graphLookup: {
      from: "employees",
      startWith: "$managerId",   // Dave's manager
      connectFromField: "managerId",  // Follow managerId
      connectToField: "_id",
      as: "superiors"  // Array of managers up the chain
    }
  }
])

// Result: Dave's document with superiors: [Bob, Alice]
```

### Real-World Aggregation Examples

```javascript
// Example 1: Top-N per group (Top 3 orders per customer)
db.orders.aggregate([
  { $sort: { customerId: 1, total: -1 } },
  {
    $group: {
      _id: "$customerId",
      topOrders: { $push: "$$ROOT" }
    }
  },
  {
    $project: {
      topOrders: { $slice: ["$topOrders", 3] }
    }
  }
])

// Example 2: Running total
db.sales.aggregate([
  { $match: { date: { $gte: ISODate("2024-01-01") } } },
  { $sort: { date: 1 } },
  {
    $group: {
      _id: {
        year: { $year: "$date" },
        month: { $month: "$date" },
        day: { $dayOfMonth: "$date" }
      },
      dailyRevenue: { $sum: "$amount" }
    }
  },
  {
    $setWindowFields: {
      partitionBy: null,
      sortBy: { "_id": 1 },
      output: {
        runningTotal: { $sum: ["$dailyRevenue"], window: { documents: ["unbounded", "current"] } }
      }
    }
  }
])

// Example 3: Pivot table (Products by Category and Size)
db.products.aggregate([
  {
    $group: {
      _id: { category: "$category", size: "$size" },
      count: { $sum: 1 },
      avgPrice: { $avg: "$price" }
    }
  },
  {
    $group: {
      _id: "$_id.category",
      sizes: {
        $push: {
          size: "$_id.size",
          count: "$count",
          avgPrice: "$avgPrice"
        }
      }
    }
  }
])
```

---

## Spring Data MongoDB

### MongoTemplate vs MongoRepository

**MongoTemplate:**
- Lower-level API
- Complete control over queries
- More verbose but flexible
- Best for complex queries

**MongoRepository:**
- Higher-level API with query methods
- Convention-based queries (method names)
- Less code, easier to read
- Best for standard CRUD operations

```java
// MongoTemplate Example
@Service
public class UserServiceTemplate {
    @Autowired
    private MongoTemplate mongoTemplate;

    public List<User> findActiveUsers() {
        Query query = new Query()
            .with(Sort.by(Sort.Direction.DESC, "createdAt"))
            .limit(10);
        query.addCriteria(Criteria.where("active").is(true));
        return mongoTemplate.find(query, User.class);
    }

    public void updateUserStats(String userId, int orderCount, BigDecimal totalSpent) {
        Update update = new Update()
            .set("orderStats.orderCount", orderCount)
            .set("orderStats.totalSpent", totalSpent)
            .currentDate("orderStats.lastUpdated");

        mongoTemplate.updateFirst(
            new Query(Criteria.where("_id").is(userId)),
            update,
            User.class
        );
    }
}

// MongoRepository Example
@Repository
public interface UserRepository extends MongoRepository<User, String>,
        QueryByExampleExecutor<User> {

    // Query methods derived from method names
    List<User> findByAgeGreaterThan(Integer age);
    User findByEmail(String email);
    List<User> findByRolesContaining(String role);
    long countByActive(boolean active);

    // Custom @Query with MongoDb Query Syntax
    @Query("{ 'age': { $gt: ?0 } }")
    List<User> findAdultUsers(Integer minAge);

    // Query with Sort and Pageable
    @Query("{ 'roles': { $in: ?0 } }")
    Page<User> findByRoles(List<String> roles, Pageable pageable);
}

@Service
public class UserServiceRepository {
    @Autowired
    private UserRepository userRepository;

    public List<User> getActiveUsers() {
        return userRepository.findByActive(true);
    }

    public User getUserByEmail(String email) {
        return userRepository.findByEmail(email);
    }

    public Page<User> getAdminUsers(int page, int size) {
        Pageable pageable = PageRequest.of(page, size,
            Sort.by(Sort.Direction.DESC, "createdAt"));
        return userRepository.findByRoles(Arrays.asList("admin"), pageable);
    }
}
```

---

## Common Interview Questions

### Q1: What's the difference between $push and $addToSet?

**Answer:**
- `$push`: Always adds element, allows duplicates
- `$addToSet`: Adds element only if not present, prevents duplicates

```javascript
// $push example
db.users.updateOne(
  { _id: 1 },
  { $push: { tags: "mongodb" } }
)
// Can result in: tags: ["mongodb", "mongodb"] (duplicates OK)

// $addToSet example
db.users.updateOne(
  { _id: 1 },
  { $addToSet: { tags: "mongodb" } }
)
// Result: tags: ["mongodb"] (duplicate prevented)
```

### Q2: How do you paginate results efficiently?

**Answer:**
Use skip() and limit() or, better yet, use range queries:

```javascript
// Less efficient (scans and skips)
db.users.find().sort({ _id: 1 }).skip(10000).limit(20)

// More efficient (range query)
db.users.find({ _id: { $gt: lastSeenId } })
    .sort({ _id: 1 })
    .limit(20)
```

### Q3: What's the difference between $unwind and $lookup?

**Answer:**
- `$unwind`: Splits array field into multiple documents
- `$lookup`: Joins with another collection (like SQL JOIN)

```javascript
// $unwind - deconstructs array
db.orders.aggregate([
  { $unwind: "$items" }
  // One order with 3 items becomes 3 documents
])

// $lookup - joins collections
db.orders.aggregate([
  {
    $lookup: {
      from: "users",
      localField: "userId",
      foreignField: "_id",
      as: "user"
    }
  }
])
```

### Q4: How do you optimize aggregation pipeline?

**Answer:**
1. Place `$match` early to filter documents
2. Use `$project` to exclude unnecessary fields
3. Place `$limit` after grouping if possible
4. Avoid `$lookup` before `$match` on large collections
5. Use indexed fields in `$match` and `$group`

```javascript
// Optimal order
db.orders.aggregate([
  { $match: { status: "completed" } },      // Filter first
  { $project: { customerId: 1, total: 1 } }, // Project early
  { $group: { _id: "$customerId", totalSpent: { $sum: "$total" } } },
  { $sort: { totalSpent: -1 } },
  { $limit: 10 }
])

// Less optimal
db.orders.aggregate([
  { $lookup: { ... } },  // Join first (expensive)
  { $match: { status: "completed" } },  // Filter late
  { $limit: 10 }
])
```

### Q5: When should you denormalize vs normalize data?

**Answer:**
**Denormalize (embed) when:**
- Data accessed together frequently
- Array size is bounded (< 1000 items)
- One-to-one relationships
- Atomicity across related data needed

**Normalize (reference) when:**
- Arrays grow unbounded
- Data updated independently
- Data shared across multiple documents
- Reduces duplication is critical
