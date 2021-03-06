import fs = require("fs");
import path = require("path");
import SCM from "./SCM";
import ClientInfo from "../client";
import Client = require("svn-spawn");
import SQLite = require("sqlite3");
import * as Util from "../util/util";
import RevisionInfo from "../RevisionInfo";

export default class SVN extends SCM {
    public static checkAccount(url: string, name: string, pw: string,
                               callback: (isSuccess: boolean) => void) {
        const svn = new Client({
            cwd: "",
            noAuthCache: true,
            password: pw,
            username: name,
        });
        try {
            svn.cmd(["info", url, "--non-interactive"], (err: SVNError, result: any) => {
                if ( err === null ) {
                    callback(true);
                } else {
                    callback(false);
                }
            });
        } catch (e) {
            callback(false);
        }
    }

    private _spawnClient: SvnSpawn.Client;
    private _repoPathInfo: Map<string, string>;
    private _rootURL: string;

    constructor(_client: ClientInfo ) {
        super(_client);
        this._spawnClient = new Client({
            cwd: "",
            noAuthCache: true,
            password: this._client.password,
            username: this._client.username,
        });
        this._rootURL = "";
        this._repoPathInfo = new Map<string, string>();
    }
    public getLog(localPath: string, length: number,
                  callback: (errMsg: string|null, revisions: string[]) => void ) {
        this.getRepositoryPath(localPath, (repoPath: string) => {
            if ( repoPath === "" ) {
                callback("Could not get Repository Path", []);
            } else {
                this._spawnClient.getLog([repoPath, "-l", String(length)], (err: SVNError, data: any) => {
                    if ( err === null) {
                        const logDatas: LogData[] = data[0];
                        const logs: string[] = [];
                        logDatas.forEach( (log: LogData) => {
                            logs.push(log.$.revision);
                        });
                        callback(null, logs);
                    } else {
                        callback(err.message, []);
                    }
                });
            }
        });
    }
    public getFirstLog(localPath: string,
                       callback: (err: string|null, rev: string) => void) {
        this.getRepositoryPath(localPath, (repoPath: string) => {
            if ( repoPath === "" ) {
                callback("Could not get Repository Path", "");
            } else {
                this._spawnClient.getLog(["-r", "1:HEAD", "--limit", "1", repoPath], (err: SVNError, data: any) => {
                    if ( err === null) {
                        const logDatas: LogData = data[0];
                        callback(null, logDatas.$.revision);
                    } else {
                        callback(err.message, "");
                    }
                });
            }
        });
    }
    public getDiff(localPath: string, revision: string,
                   callback: (errMsg: string|null, diffStr: string) => void) {
        this.getRepositoryPath(localPath, (repoPath: string) => {
            if ( repoPath === "" ) {
                callback("Could not get Repository Path", "");
            } else {
                const revRange: string = revision + ":" + String(Number(revision) - 1);
                this._spawnClient.cmd([ "diff", repoPath,  "-r", revRange],
                (errDiff: SVNError, dataDiff: any) => {
                    if (errDiff === null) {
                        callback(null, dataDiff);
                    } else {
                        callback(errDiff.message, "");
                    }
                });
            }
        });
    }
    public getLocalFileDiff(localPath: string, callback: (err: string|null, diffStr: string) => void) {
        this.getRepositoryPath(localPath, (repoPath: string) => {
            if ( repoPath === "" ) {
                callback("Could not get Repository Path", "");
            } else {
                const dirPath: string = path.dirname(localPath);
                if ( Util.existDirectory(dirPath) === true ) {
                    const tempPath: string = path.join(dirPath, "temp" + Math.random().toString());
                    this._spawnClient.cmd([ "export", repoPath, tempPath] ,
                    (err: SVNError, data: any) => {
                        if ( err === null ) {
                            Util.getDiff(localPath, tempPath, (err2: string|null, result: string) => {
                                fs.unlinkSync(tempPath);
                                callback(err2, result);
                            });
                        } else {
                            if ( fs.existsSync(tempPath) === true ) {
                                fs.unlinkSync(tempPath);
                            }
                            callback("svn export failed : " + err.message, "");
                        }
                    });
                } else {
                    callback("could not get directory : " + localPath, "");
                }
            }
        });
    }
    public getRevisionInfo(localPath: string, revName: string,
                           callback: (err: string|null, revisionInfo: RevisionInfo|null) => void ) {
        const mainPath: string = this.getMainPath(localPath);
        this.getRootURL(localPath, (err: any, url: string) => {
            if ( err !== null ) {
                callback("Could not get Repository Path", null);
            } else {
                this._spawnClient.getLog([url, "-r", revName], (errLog: SVNError, data: any) => {
                    if ( errLog === null) {
                        const logData: LogData = data[0];
                        this.getDiff(localPath, revName, (errMsg: any, diffStr: string) => {
                            if ( errMsg !== null ) {
                                callback(errMsg, null);
                            } else {
                                callback(errMsg,
                                new RevisionInfo(revName, logData.author, logData.msg, logData.date, diffStr));
                            }
                        });
                    } else {
                        callback(errLog.message, null);
                    }
                });
            }
        });

    }
    private getRootURL(localPath: string, callback: (err: string|null, diffStr: string) => void ) {
        if ( this._rootURL === "" ) {
            const mainPath: string = this.getMainPath(localPath);
            if ( mainPath === "" ) {
                callback("Could not get Repository Path", "");
            }
            const dbPath: string = path.join(mainPath, "wc.db");
            const repoPath: string = (path.resolve(localPath).replace(path.resolve(mainPath, ".."), "")).
            substr(1).split("\\").join("/");
            const query: string = "select (R.root) as Path \
            from NODES as N, REPOSITORY as R \
            where R.id = N.repos_id AND N.local_relpath = \"" + repoPath + "\"";
            const db = new SQLite.Database(dbPath, (err: Error) => {
                db.on("open", () => {
                    db.each(query, (queryErr: any, row: any) => {
                        if ( queryErr === null ) {
                            this._rootURL = row.path;
                            callback(null, row.Path);
                        } else {
                            callback("Could not get Repository Path", "");
                        }
                    });
                });
            });
        } else {
            callback(null, this._rootURL);
        }
    }
    private getRepositoryPath(localPath: string, callback: (result: string) => void ) {
        const fullRepoPath: any = this._repoPathInfo.get(localPath);
        if ( fullRepoPath === undefined ) {
            const mainPath: string = this.getMainPath(localPath);
            if ( mainPath === "" ) {
                callback("");
            }
            const repoPath: string = (path.resolve(localPath).replace(path.resolve(mainPath, ".."), "")).
                                    substr(1).split("\\").join("/");
            const dbPath: string = path.join(mainPath, "wc.db");
            const query: string = "select (R.root || \"/\" || N.repos_path) as Path \
                           from NODES as N, REPOSITORY as R \
                           where R.id = N.repos_id AND N.local_relpath = \"" + repoPath + "\"";
            const db = new SQLite.Database(dbPath, (err: Error) => {
                db.on("open", () => {
                    db.each(query, (queryErr: any, row: any) => {
                        if ( queryErr === null ) {
                            this._repoPathInfo.set(localPath, row.Path);
                            callback(row.Path);
                        } else {
                            callback("");
                        }
                    });
                });
            });
        } else {
            callback(fullRepoPath);
        }
    }
}
