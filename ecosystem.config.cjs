module.exports = {
    apps: [{
        name: "lms_portal",
        script: "./server.js",
        watch: false,
        env: {
            NODE_ENV: "production",
        }
    }]
};
