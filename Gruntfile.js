'use strict';

module.exports = function(grunt) {
    require('load-grunt-tasks')(grunt);

    var config = {
        var mainFiles = require('./scripts/sources.json');
        'src/slicer.js',
        'src/writer.js',
        'src/reader.js',
        'src/merger.js',
        'src/video.js',
        'src/main.js',
        'src/outro.js'
    ];

    grunt.initConfig({
        pkg: grunt.file.readJSON('package.json'),

        concat: {
            dist: {
                src: mainFiles,
                dest: 'dist/displaysocket.js'
            }

        },

        uglify: {
            dist: {
                files: {
                    'dist/displaysocket.min.js': ['dist/displaysocket.js']
                }
            }
        },

        watch: {
            js: {
                files: [
                    'Gruntfile.js',
                    'index.html',
                    'src/**/*',
                    'demos/**/*'
                ],
                tasks: ['concat', 'jshint'],
                options: {
                    livereload: {
                        port: 35729,
                        key: grunt.file.read('ds.key'),
                        cert: grunt.file.read('ds.crt'),
                    },
                }
            }
        },

        connect: {
            options: {
                protocol: 'https',
                key: grunt.file.read('ds.key').toString(),
                cert: grunt.file.read('ds.crt').toString(),
                ca: grunt.file.read('ds.crt').toString(),
                port: 9000,
                //open: true,
                livereload: 35729,
                // you can also use your IP as hostname
                hostname: 'localhost',
                //keepalive: true
            },

            livereload: {
                options: {
                    middleware: function(connect) {
                        return [
                            connect.static(config.base)
                        ];
                    }
                }
            },

        },

        jshint: {
            options: {
                jshintrc: '.jshintrc',
            },
            all: [
                'Gruntfile.js',
                'src/*.js'
            ]
        }
    });

    grunt.registerTask('default', [ /*'watch',*/ 'connect' ]);
    grunt.registerTask('dist', function() {
        var done = this.async();
        require('child_process').execFile(process.execPath, ['scripts/build.mjs'], function(error, stdout, stderr) {
            grunt.log.write(stdout);
            if (stderr) { grunt.log.error(stderr); }
            done(!error);
        });
    });
    grunt.registerTask('serve', function() {
        grunt.task.run([
            'concat',
            'connect:livereload',
            'watch'
        ]);
    });
};
