// Bu dosya, gerçek Express modülünün içeriğini temsil eder.
// require('express') çağrıldığında bu dosya yüklenecektir.

module.exports = () => {
    console.log("Express module loaded from Aperium!");
    return {
        get: (route, handler) => {
            console.log(`- GET request handler set for: ${route}`);
        },
        listen: (port, callback) => {
            console.log(`- Server started on port: ${port}`);
            if (callback) callback();
        }
    };
};
