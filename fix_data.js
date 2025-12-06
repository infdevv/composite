const fs = require("fs");

// Load JSON
let data = JSON.parse(fs.readFileSync("old_data.json", "utf8"));

let new_data = {};

for (const key of Object.keys(data)) {
    let entry = { ...data[key] }; // copy the object

    delete entry.key;
    delete entry.createdDate;
    delete entry.hashedIP;

    if (entry.lastAdViewedDate === 0) {
        continue; // skip this key entirely
    }

    new_data[key] = entry; // preserve the key name
}

// Optionally save:
fs.writeFileSync("new_data.json", JSON.stringify(new_data, null, 2));
