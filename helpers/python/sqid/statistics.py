import os
import json
import time
import shutil
import logging
import subprocess

from pathlib import Path
from copy import deepcopy
from tempfile import NamedTemporaryFile
from collections import defaultdict

from . import config


SEPARATORS = (',', ':')
TIMESTAMP_KEYS = {'dump': 'dumpDate',
                  'classes': 'classUpdate',
                  'properties': 'propertyUpdate',
                  }
ISO8601_TIMESTAMP_FORMAT = "%Y-%m-%dT%H:%M:%S%z"
logger = logging.getLogger(__name__)


def get_current_timestamp():
    """Returns the current timestamp in suitable (ISO 8601) format."""
    return time.strftime(ISO8601_TIMESTAMP_FORMAT)


def _json_file_name(name):
    """Returns the name of the statistics file for `name`."""
    return name + '.json'


def get_json_data(name):
    """Load statistics file "`name`.json"."""
    try:
        with open(_json_file_name(name), 'r') as file:
            return json.load(file)
    except OSError:
        return {}


def update_json_data(name, data, timestamp=None):
    """Atomically replaces the data in file "`name'.json"."""
    try:
        with NamedTemporaryFile(mode='w', delete=False) as file:
            logger.info('Writing new JSON %s data ...', name)
            json.dump(data, file, separators=SEPARATORS)
            logger.info('Writing new %s JSON file ...', name)
    except RuntimeError as err:
        logger.error('Writing dump failed: %s', err)
    else:
        os.chmod(file.name, 0o644)
        shutil.move(file.name, _json_file_name(name))
        if timestamp is not None:
            update_timestamp(name, timestamp)
        logger.info('Update for %s complete.', name)


def update_split_json_data(name, data, chunk_size):
    """Updates split JSON data for file "`name.json",
       with customisable chunk size."""

    chunks = defaultdict(dict)

    for entity, record in data.items():
        chunk = int(entity) // chunk_size
        chunks[chunk][entity] = record

    for index, chunk in chunks.items():
        update_json_data('{}-{}'.format(name, index), chunk)


def get_timestamp(name):
  """Retrieves the statistics timestamp `name`."""
  data = get_json_data('statistics')
  return data[TIMESTAMP_KEYS[name]]


def update_timestamp(name, timestamp):
    """Sets the statistics timestamp `name` to `timestamp`."""
    data = get_json_data('statistics')
    data[TIMESTAMP_KEYS[name]] = timestamp

    with open(_json_file_name('statistics'), 'w') as file:
        json.dump(data, file)


def merge(old, new, default_others=None):
    """Merges two statistics documents `old` and `new`.

    `default_others` is a dict that will be applied to all items
    not updated.
    """
    merged = defaultdict(dict, deepcopy(old))

    for key in new.keys():
        merged[key].update(new[key])

    if default_others is not None:
        others = old.keys() - new.keys()

        for key in others:
            merged[key].update(default_others)

    return dict(merged)


def check_new_dump(script_path):
  """Check for a new dump file. If present, queue a job on the grid to
  rebuild the full statistics."""
  dumpdate = get_timestamp('dump')
  basedir = Path(config.DUMP_LOCATION)
  dumps = {}

  logger.debug("Enumerating dumps in `%s'", basedir)
  for subdir in (path for path in basedir.iterdir() if path.is_dir()):
    date = subdir.parts[-1]
    filename = config.DUMP_BASENAME.format(date=date)
    dumpfile = subdir.joinpath(filename)

    if dumpfile.exists():
      logger.debug("Found dump `%s', dated `%s'", filename, date)
      dumps[date] = dumpfile

  latest = sorted(dumps.keys())[-1]
  logger.debug("Most recent dump is dated `%s', statistics based on `%s'",
               latest, dumpdate)

  if latest > dumpdate:
    logger.info("Found more recent dump `%s'", latest)

    link = Path(config.DUMP_LINK.format(date=latest))
    link.parent.mkdir(parents=True, exist_ok=True)
    link.symlink_to(dumps[latest])

    job = [script_path, '--only=process-dump']
    logger.debug("submitting job: `%s'", repr(job))
    _queue_job(config.DUMP_PROCESS_MEMORY, *job)

def process_dump(script_path):
  """Generate statistics from a dump file. After success, move the statistics into place."""
  pass


def _queue_job(memory, *args):
  return subprocess.run([config.GRID_SUBMIT,
                         config.GRID_MEMORY.format(memory=memory),
                         *args])
