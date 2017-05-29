from setuptools import setup


setup(
    name='pyhackchat',
    version='0.1',
    description='Simple chat server',
    author='Jan Hermann',
    author_email='dev@hermann.in',
    url='https://github.com/azag0/pyhackchat',
    packages=['pyhackchat'],
    classifiers=[
        'Development Status :: 3 - Alpha',
        'Environment :: Console',
        'License :: OSI Approved :: Mozilla Public License 2.0 (MPL 2.0)',
        'Operating System :: POSIX',
        'Programming Language :: Python :: 3.6',
        'Topic :: Communications :: Chat'
    ],
    license='Mozilla Public License 2.0',
    install_requires=[
        'uvloop==0.8.0',
        'websockets==3.3'
    ],
)
