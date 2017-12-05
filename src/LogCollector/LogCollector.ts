import * as async from "async";
import * as repo from "./client";
import Translator from "./Translator";
import ClientInfo from "./client";
import SourceRange from "./SourceRange";
import SimpleRange from "./SimpleRange";
import RevisionInfo from "./RevisionInfo";
import SCM from "./scm/scm";
import SVN from "./scm/svn";
import GIT from "./scm/git";
import * as diffParser from "diffParser";

export default class LogCollector {
    public static getSCMKind(localPath: string) {
        return SCM.getSCMKind(localPath);
    }

    private _scm: SCM;
    private _revInfo: Map<string, SourceRange>;
    private _currentRevision: string;
    private _localSourceRange: SourceRange;
    private _localPath: string;
    constructor(private _client: ClientInfo ) {
        if ( _client.kind === "svn" ) {
            this._scm = new SVN(_client);
        } else if ( _client.kind === "git" ) {
            this._scm = new GIT(_client);
        }
    }

    public getLogWithRange(localPath: string, range: SimpleRange, length: number ,
                           callback: (err: string|null, revisions: string[]) => void ) {
        this._currentRevision = "-1";
        this._revInfo = new Map<string, SourceRange>();
        this._localSourceRange = new SourceRange(range.startLine, range.endLine);
        this._localPath = localPath;
        this.getLocalFileDiff(this._localPath, (errDiff: string|null, diffStr: string) => {
            if ( errDiff === null ) {
                this.collectLog(length, diffStr, (err: string|null, revisions: string[]) => {
                    callback(err, revisions);
                });
            } else {
                callback(errDiff, []);
            }
        });
    }
    public getNextLogWithRange(length: number, callback: (err: string|null, revisions: string[]) => void ) {
        this.collectLog(length, "", (err: string|null, revisions: string[]) => {
            callback(err, revisions);
        });
    }

    public getLog(localPath: string, length: number,
                  callback: (err: string|null, revisions: string[]) => void): void {
        this._scm.getLog(localPath, length, (err: string|null, revs: string[] ) => {
            callback(err, revs);
        });
    }

    public getDiff(localPath: string, revision: string, callback: (err: string|null, diffStr: string) => void): void {
        this._scm.getDiff(localPath, revision, (err: string|null, diffStr: string ) => {
            callback(err, diffStr);
        });
    }

    public getRevisionInfo(localPath: string, revision: string,
                           callback: (err: string|null, revInfo: RevisionInfo|null) => void ): void {
        this._scm.getRevisionInfo(localPath, revision, (err: any, revInfo: RevisionInfo|null) => {
            if ( err !== null ) {
                callback(err, null);
            } else {
                callback(null, revInfo);
            }
        });
    }

    private getLocalFileDiff(localPath: string, callback: (err: string|null, diffStr: string) => void): void {
        this._scm.getLocalFileDiff(localPath, (err: string|null, diffStr: string ) => {
            callback(err, diffStr);
        });
    }

    private collectLog(length: number, localDiff: string, callback: (err: string|null, revisions: string[]) => void) {
        const tasks = [
            (collect_diff_callback: any) => {
                this.getLog(this._localPath, length, (err: string|null, revs: string[]) => {
                    collect_diff_callback(err, revs);
                });
            },
            (revs: string[], collect_changed_rev_callback: any) => {
                let revLength: number = revs.length;
                const revArray: string[] = [];
                const diffsByRev: Map<string, string> = new Map<string, string>();
                for ( const rev of revs ) {
                    this.getDiff(this._localPath, rev, (err: string|null, diffStr: string) => {
                        if ( err === null ) {
                            diffsByRev.set(rev, diffStr);
                            if ( diffsByRev.size === revLength) {
                                if ( localDiff !== "" ) {
                                    revs.unshift("-1");
                                    diffsByRev.set("-1", localDiff);
                                }
                                collect_changed_rev_callback(null, revs, diffsByRev);
                            }
                        } else if (diffStr !== "") {
                            collect_changed_rev_callback(err, "");
                        } else {
                            revs.splice(revs.length - 1, 1);
                            revLength--;
                        }
                    });
                }
            },
            (revs: string[], diffsByRev: Map<string, string>, return_callback: any) => {
                let prevRevision: string = this._currentRevision;
                const changedRevs: string[] = [];
                for ( const rev of revs ) {
                    const range: SourceRange = this.getPreviousSourceRange(prevRevision);
                    if ( range.isNull() ) {
                        break;
                    }
                    if (diffsByRev.get(rev) === undefined ) {
                        prevRevision = rev;
                        this._revInfo.set(prevRevision, range);
                        continue;
                    }
                    const chunks: Chunk[] = diffParser(diffsByRev.get(rev))[0].chunks;
                    const translatedResult = Translator.translateSourceRangeFromDiff(range, chunks);
                    const translatedRange = translatedResult[0] as SourceRange;
                    if (translatedRange.isNull() ) {
                        break;
                    }
                    if ( translatedResult[1] as boolean ) {
                        changedRevs.push(rev);
                    }
                    prevRevision = rev;
                    this._revInfo.set(prevRevision, translatedRange);
                }
                return_callback(null, changedRevs);
            }];
        async.waterfall(tasks, (err: string|null, result: any) => {
            callback(err, result);
        });
    }

    private getPreviousSourceRange(prevRevision: string) {
        const range = new SourceRange(-1, -1);
        const prevRange: any = this._revInfo.get(prevRevision);
        if ( prevRange !== undefined ) {
            range.startLine = (prevRange as SourceRange).startLine;
            range.endLine = (prevRange as SourceRange).endLine;
        } else {
            range.startLine = this._localSourceRange.startLine;
            range.endLine = this._localSourceRange.endLine;
        }
        return range;
    }
}
