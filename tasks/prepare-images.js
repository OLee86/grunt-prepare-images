/*!
 * grunt-prepare-images
 * Copyright (c) 2013 by Oliver Liermann <liermann@strg-agency.de>
 *
 * MIT LICENSE
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 */


'use strict';

module.exports = function(grunt) {

    var _    = grunt.util._,
        fs   = require('fs'),
        gm   = require('gm'),
        path = require('path'),
        fsX  = require('node-fs');


    grunt.registerTask('prepare-images', 'generate data-urls, stylus files', function() {
        grunt.config.requires('meta.folders.images');
        this.async();

        var imagePath         = grunt.template.process(grunt.config('meta.folders.images')),
            relativeImagePath = '../images/',
            fileTypes         = ['png','jpg','gif'],
            dataUrlLimit      = 10000,

            stylusAliasFile  = grunt.template.process(grunt.config('meta.folders.css_app'))+'_stylus/images.styl',
            stylusGroupsPath = grunt.template.process(grunt.config('meta.folders.css_app'))+'groups/',

            startTime,


            // call callback with array of images found in filepath
            walker     = function(basepath,callback){
                var depth  = 0,
                    images = [],

                    walk   = function(filepath,callback){
                        depth++;

                        var files = fs.readdirSync(filepath),
                            i, stats;

                        for(i=0;i < files.length;i++){
                            stats = fs.statSync(filepath+files[i]);

                            if(stats.isDirectory()){
                                walk(filepath+files[i]+'/');
                            }else{
                                images.push({
                                    path     : filepath.replace(basepath,''),
                                    file     : files[i],
                                    filesize : stats.size
                                });
                            }
                        }

                        depth--;
                        if(depth === 0 && _.isFunction(callback)){
                            grunt.verbose.writeln(grunt.log.wordlist(['found '+images.length+' OK'],{ color: 'green' }));
                            grunt.verbose.writeln(
                                grunt.log.wordlist(
                                    _.pluck(images,'file').sort(),
                                    { color: 'cyan', separator: ', ' }
                                )
                            );
                            callback();
                        }
                    };


                grunt.verbose.write('search for images...');
                walk(basepath,function(){
                    if(_.isFunction(callback)){
                        callback(images);
                    }
                });
            },


            // detect size, convert to data-url, create aliases & name of every image
            processImages = function(images,basePath,callback){
                grunt.verbose.write('retrieve additonal information...');

                var after = _.after(images.length,function(){
                        _.each(images,function(image,key){
                            image.aliasLength = aliasLength[image.group] || 0;
                        });
                        images = _.sortBy(images,'group');

                        grunt.verbose.ok();

                        if(_.isFunction(callback)){
                            callback(images);
                        }
                    }),

                    aliasLength = {};

                _.each(images,function(image){
                    var ext = path.extname(image.file).replace('.','');

                    if(!_.str.startsWith(image.file,'.') && !_.str.startsWith(image.file,'_') && _.indexOf(fileTypes,ext) > -1){
                        var imageBuffer = fs.readFileSync(basePath+image.path+image.file),
                            nestedGroups = _.rtrim(image.path,'/','').split('/');

                        image.group     = nestedGroups[0];
                        image.subGroups = nestedGroups.slice(1);

                        // class name
                        image.name      = _.slugify(path.basename(image.file,ext));

                        // var name
                        image.alias     = (image.group ? nestedGroups.join('_')+'_' : '') + image.name.replace(/-/g,'_');

                        // add data-url
                        if(image.filesize <= dataUrlLimit){
                            image.dataUrl = 'data:image/'+ext.toLowerCase()+';base64,'+imageBuffer.toString('base64');
                        }

                        //detect longest alias
                        if(!aliasLength[image.group] || image.alias.length > aliasLength[image.group]){
                            aliasLength[image.group] = image.alias.length;
                        }

                        // detect image size
                        gm(imageBuffer).size(function(err, size){
                            if(!err && size){
                                image.size = size;
                            }
                            after();
                        });


                    }else{
                        console.log('ignoring: '+image);
                        after();
                    }
                });
            },


            // return a yyyy-mm-dd hh:ii timestamp
            getTimestamp = function(){
                var now = new Date();

                return _.vsprintf(
                    '%s-%s-%s %s:%s',
                    _.map(
                        [now.getFullYear(),now.getMonth()+1,now.getDate(),now.getHours(),now.getMinutes()],
                        function(str){
                            return _.str.lpad(str,2,'0');
                        }
                ));
            },


            // output alias & data-url/filepath
            generateAliasFile  = function(images,file,basePath,callback){
                grunt.verbose.write('create stylus variables file...');

                var aliasFile = fs.createWriteStream(file);

                aliasFile.once('open', function(){
                    aliasFile.write('// Generated on: '+getTimestamp()+'\n\n');

                    _.each(images,function(image,index){

                        // group changed, insert empty lines
                        if(index > 0 && images[index-1].group !== image.group){
                            aliasFile.write('\n');
                        }

                        // write one line
                        aliasFile.write(_.sprintf("/* %s */ %s = url('%s')\n",
                            _.rpad(image.size.width+'x'+image.size.height,7,' '),
                            _.rpad(image.alias,image.aliasLength,' '),
                            image.dataUrl || basePath+image.path+image.file
                        ));
                    });

                    aliasFile.write('\n');
                    aliasFile.end();
                    grunt.verbose.ok();
                    callback();
                });
            },


            // output stylus group definitions
            generateGroupFiles = function(images,groupsPath,callback){
                grunt.verbose.write('create stylus group definition files...');

                var groups   = _.filter(_.uniq(_.pluck(images,'group'),true)),
                    finished = _.after(groups.length,function(){
                        grunt.verbose.ok();
                        callback();
                    });


                if(!fs.existsSync(groupsPath)){
                    fsX.mkdirSync(groupsPath,'0777',true);
                }


                _.each(groups,function(group){
                    var groupImages = _.where(images,{ group: group }),

                        grpFile,
                        groupFilePath = groupsPath+group+'.styl',
                        grpFileExists = fs.existsSync(groupFilePath),

                        output      = [],
                        depth       = 0,
                        tabSize     = 4,
                        tab         = _.str.repeat(' ',tabSize),


                        indentWrite = function(array,depth){
                            var tabs = _.str.repeat(' ',depth*tabSize || 0);

                            output.push(
                                _.map(array,function(str){ return tabs+str; })
                                .join('\n')
                            );
                        },

                        writeFile = function(filepath,data){
                            fs.writeFile(filepath, data, function(err){
                                if(err){
                                    grunt.error('could not save file '+groupFilePath);
                                }else{
                                    finished();
                                }
                            });
                        };


                    if(!grpFileExists){
                        indentWrite([
                            '',
                            '.'+group,
                            tab+'display block',
                            '\n',
                            '\n'
                        ],0);
                    }


                    // header + group definition
                    indentWrite([
                        '// -------------------------------------------------------',
                        '// Do not edit after this line! Your changes wont persist.',
                        '// Generated on: '+getTimestamp()+'\n',
                        '.'+group,
                        ''
                    ]);

                    // increase indentation
                    depth++;
                    _.each(groupImages,function(image){

                        var currDepth = image.subGroups.length,
                            data = [
                                '&.'+image.name,
                                tab+'width '+image.size.width+'px',
                                tab+'height '+image.size.height+'px',
                                tab+'background-image '+image.alias+'\n\n'
                            ];

                        // output class, size & background-image
                        if(currDepth){
                            indentWrite([
                                '&.'+image.subGroups.join('-')+'\n\n'
                            ],depth);
                        }

                        indentWrite(data,depth+currDepth);
                    });



                    if(grpFileExists){
                        fs.readFile(groupFilePath, function(err, data){
                            if(err){
                                grunt.fail.warn('could not read file '+groupFilePath);
                            }

                            var lines    = data.toString('utf8').split('\n'),
                                position = 0;

                            _.each(lines,function(line){
                                if(line === '// -------------------------------------------------------'){
                                    return false;
                                }
                                position += line.length+1;
                            });

                            writeFile(groupFilePath,data.toString('utf8').substring(0,position)+output.join(''));
                        });
                    }else{
                        writeFile(groupFilePath,output.join(''));
                    }
                });
            };



        startTime = (new Date()).getTime();

        walker(imagePath,function(images){

            processImages(images,imagePath,function(images){

                generateAliasFile(images,stylusAliasFile,relativeImagePath,function(){

                    generateGroupFiles(images,stylusGroupsPath,function(){
                        var endTime = (new Date()).getTime();
                        grunt.log.writeln('finished '+grunt.log.wordlist(['successful'],{ color: 'green' })+' in '+(endTime-startTime)+'ms');
                    });
                });
            });
        });
    });
};