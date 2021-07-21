#!/usr/bin/env node
import { Command } from 'commander';
import axios, { AxiosRequestConfig, AxiosResponse } from 'axios';
import { concat } from 'lodash';
import chalk from 'chalk';
import { exec } from 'child_process';

const program = new Command();

const hasBuiltInTypes = (data: string) => {
    const builtInTypescriptRegex = /built-in type declarations/g;
    return builtInTypescriptRegex.test(data);
};

const getPackageUrl = (pUrl: string) => {
    const baseUrl = 'https://www.npmjs.com/package/';
    return `${baseUrl}${pUrl}`;
};

type AxiosFunction = (url: string, config?: AxiosRequestConfig) => Promise<AxiosResponse>;

const tryCatch: (axios: AxiosFunction, p: string) => Promise<[AxiosResponse, null] | [null, string]> = async (
    axios: AxiosFunction,
    p: string
) => {
    try {
        const result = await axios(getPackageUrl(p));
        return [result, null];
    } catch (e) {
        return [null, e.message];
    }
};

type StatusResponse = {
    status: 'error' | 'ok' | 'warn';
    message: string;
    type: null | string;
    pkg: string;
    isDev: boolean;
};

program
    .version('1.0.0')
    .argument('<packages...>')
    .option('-D', '--dev', false)
    .option('-W', '--ignore-workspace-root-check')
    .action(async (packages) => {
        const { D, W } = program.opts();
        const list: StatusResponse[] = await Promise.all(
            packages.map(async (p: string) => {
                const isDevRegex = /\$D$/g;
                const isDev = isDevRegex.test(p);
                const pak = isDev ? p.replace(isDevRegex, '') : p;

                const [packageResponse, packageError] = await tryCatch(axios.get, pak);

                if (packageError != null)
                    return {
                        status: 'error',
                        message: packageError,
                        type: null,
                        isDev: isDev || D,
                        pkg: pak,
                    };

                if (!packageResponse) {
                    return;
                }

                const hasTypes = hasBuiltInTypes(packageResponse.data);

                if (hasTypes)
                    return {
                        status: 'ok',
                        pkg: pak,
                        type: null,
                        isDev: isDev || D,
                        message: `Types already exists for ${pak}`,
                    };

                const typePackage = `@types/${pak}`;

                const [, typeError] = await tryCatch(axios.get, typePackage);

                if (typeError != null)
                    return {
                        status: 'warn',
                        pkg: pak,
                        type: null,
                        isDev: isDev || D,
                        message: `Types is not found on npm for ${typePackage}`,
                    };

                return {
                    status: 'ok',
                    pkg: pak,
                    type: typePackage,
                    isDev: isDev || D,
                    message: `Types are valid for ${typePackage}`,
                };
            })
        );
        const errorPackages = list
            .filter((elem) => elem.status === 'error')
            .map(
                (elem) =>
                    chalk.bgRed.bold.underline(`Error:`) + chalk.red.bold(` ${elem.pkg} `) + chalk.red(elem.message)
            )
            .join('\n')
            .trim();

        const warningPackages = list
            .filter((elem) => elem.status === 'warn')
            .map(
                (elem) =>
                    chalk.bgYellow.bold.underline(`Warn:`) +
                    chalk.yellow.bold(` ${elem.pkg} `) +
                    chalk.yellow(elem.message)
            )
            .join('\n')
            .trim();

        const successPackages = list
            .filter((elem) => elem.status === 'ok')
            .map(
                (elem) =>
                    chalk.bgGreen.bold.underline(`Ok:`) + chalk.green.bold(` ${elem.pkg} `) + chalk.green(elem.message)
            )
            .join('\n')
            .trim();

        const typesPackages = list.filter((elem) => elem.type !== null).map((elem) => elem.type);
        const devPackages = list.filter((elem) => elem.isDev && elem.status !== 'error').map((elem) => elem.pkg);
        const notDevPackages = list
            .filter((elem) => !elem.isDev && elem.status !== 'error')
            .map((elem) => elem.pkg)
            .join(' ');

        const devs = concat(typesPackages, devPackages).join(' ');

        const joinStr = `${errorPackages !== '' ? `${errorPackages}\n` : ``}${
            warningPackages !== '' ? `${warningPackages}\n` : ``
        }${successPackages !== '' ? `${successPackages}\n` : ``}`;
        console.log(joinStr);

        if (devs.length === 0 && notDevPackages.length === 0) {
            console.log(`No packages`);
            return;
        }

        const yarnDev = devs.length === 0 ? null : `yarn add ${devs} -D`;
        const yarn = notDevPackages.length === 0 ? null : `yarn add ${notDevPackages}`;
        const yarnCommand = yarnDev && yarn ? `${yarn} && ${yarnDev}` : yarnDev ? yarnDev : yarn;
        if (!yarnCommand) return;
        console.log();
        exec(yarnCommand + `${W ? ` -W` : ``}`, (err, stdout, stderr) => {
            if (stderr || err) {
                const error = stderr === err?.message ? err.message : <string>err?.message;
                console.log(chalk.bgRed.bold.underline(`Error:`) + chalk.red(` ${error}`));
            }
            console.log(stdout);
        });
    });

program.parse();
