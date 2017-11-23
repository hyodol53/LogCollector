/** Declaration file generated by dts-gen */



declare namespace simple_git {
    class Git {
        constructor(baseDif: string);

        diff( options: string[] , callback: (err: any, result: any)=>void ): any
        log( options: string[] , callback: (err: any, result: any)=>void ): any        
    }

}

declare module 'simple-git' {
    const Git: typeof simple_git.Git;
    export = Git;
}