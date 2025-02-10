# Profile SourceMap

A CLI tool to remap CPU profiles from Minecraft Bedrock using source maps.

## Installation

Install the package globally:

```bash
npm install -g git+https://github.com/stirante/profile-sourcemap.git
```

## Usage

Run the tool from the command line by providing the CPU profile and the project root:

```bash
profile-sourcemap ./path/to/profile.cpuprofile ./path/to/project-root
```

This will create a new file in the location of the original profile file named `<original file name>_remapped.cpuprofile` as well as return the absolute path to the newly created file in stdout.
